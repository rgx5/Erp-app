import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, toPage } from '../../platform/http/validation.js';
import { accounts, journalLines } from '../accounting/accounting.schema.js';
import { fromUnits, toUnits } from '../accounting/money.js';
import { PostingService } from '../accounting/posting.service.js';
import { first, Recorder, updateVersioned } from '../masterdata/helpers.js';
import { bankAccounts, bankMatches, bankStatementLines, bankStatements } from './banking.schema.js';
import type { CreateBankAccountInput, ImportStatementInput, ListLinesQuery, UpdateBankAccountInput } from './banking.schemas.js';

export type BankAccountRow = typeof bankAccounts.$inferSelect;
export type StatementRow = typeof bankStatements.$inferSelect;
export type StatementLineRow = typeof bankStatementLines.$inferSelect;

/** Signed decimal text to integer units of 1/10000. */
export const signedUnits = (text: string): bigint => (text.startsWith('-') ? -toUnits(text.slice(1)) : toUnits(text));
const dayMs = 86_400_000;
const daysApart = (a: string, b: string): number => Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / dayMs));

type LedgerRow = { id: string; entry_id: string; entry_no: string; posting_date: string; net: string; description: string | null };
export interface Candidate { journalLineId: string; entryId: string; entryNo: string; postingDate: string; amount: string; description: string | null; daysApart: number }

@Injectable()
export class BankService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- bank accounts ----------------------------------------------------------------------------------------------------
  createAccount(tenantId: string, actorId: string, input: CreateBankAccountInput): Promise<BankAccountRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, input.companyId), eq(accounts.id, input.accountId)));
      if (!a) throw validationFailed([{ path: 'accountId', message: 'This account does not exist in this company' }]);
      if (a.type !== 'asset' || a.isGroup || a.status !== 'active' || a.controlKind !== null) throw validationFailed([{ path: 'accountId', message: 'Must be an ordinary, active asset account (not a group or a control account)' }]);
      const [taken] = await tx.select({ id: bankAccounts.id }).from(bankAccounts).where(and(eq(bankAccounts.tenantId, tenantId), eq(bankAccounts.accountId, input.accountId)));
      if (taken) throw new AppError(409, 'already_a_bank_account', 'This ledger account is already set up as a bank account');
      const row = first(await tx.insert(bankAccounts).values({ tenantId, id: uuidv7(), companyId: input.companyId, accountId: input.accountId, name: input.name, bankName: input.bankName ?? null, accountRef: input.accountRef ?? null, clearedThrough: input.clearedThrough ?? null, createdBy: actorId }).returning(), 'Bank account');
      return this.recorder.record(tx, tenantId, 'bank_account', 'created', row, { accountId: input.accountId, name: input.name });
    });
  }

  updateAccount(tenantId: string, id: string, version: number, input: UpdateBankAccountInput): Promise<BankAccountRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (input.clearedThrough !== undefined) {
        const [s] = await tx.select({ id: bankStatements.id }).from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.bankAccountId, id), eq(bankStatements.status, 'active'))).limit(1);
        if (s) throw new AppError(409, 'has_statements', 'The cleared-through date cannot change once statements are imported; void them first');
      }
      const set = { ...input, version: sql`${bankAccounts.version} + 1`, updatedAt: sql`now()` };
      const row = await updateVersioned<BankAccountRow>(tx, bankAccounts, tenantId, id, version, set, 'Bank account');
      return this.recorder.record(tx, tenantId, 'bank_account', 'updated', row, { fields: Object.keys(input) });
    });
  }

  listAccounts(tenantId: string, companyId: string): Promise<BankAccountRow[]> {
    return this.uow.inTenant(tenantId, (tx) => tx.select().from(bankAccounts).where(and(eq(bankAccounts.tenantId, tenantId), eq(bankAccounts.companyId, companyId))).orderBy(asc(bankAccounts.name), asc(bankAccounts.id)), { readOnly: true });
  }

  private async account(tx: Tx, tenantId: string, id: string): Promise<BankAccountRow> {
    return first(await tx.select().from(bankAccounts).where(and(eq(bankAccounts.tenantId, tenantId), eq(bankAccounts.id, id))), 'Bank account');
  }

  // ---- statements -----------------------------------------------------------------------------------------------------------
  /** Imports one statement. The same content is never imported twice, and two statements of an account never overlap in time. */
  importStatement(tenantId: string, actorId: string, bankAccountId: string, input: ImportStatementInput) {
    const sum = input.lines.reduce((a, l) => a + signedUnits(l.amount), 0n);
    const opening = signedUnits(input.openingBalance);
    const closing = signedUnits(input.closingBalance);
    if (opening + sum !== closing) throw validationFailed([{ path: 'closingBalance', message: `Opening balance plus the lines is ${fromUnits(opening + sum)}, not ${fromUnits(closing)}` }]);
    input.lines.forEach((l, i) => {
      if (l.date < input.periodFrom || l.date > input.periodTo) throw validationFailed([{ path: `lines.${i}.date`, message: 'Must fall inside the statement period' }]);
      if (signedUnits(l.amount) === 0n) throw validationFailed([{ path: `lines.${i}.amount`, message: 'Must not be zero' }]);
    });
    const hash = createHash('sha256').update(JSON.stringify({ bankAccountId, ...input })).digest('hex');
    return this.uow.inTenant(tenantId, async (tx) => {
      const bank = await this.account(tx, tenantId, bankAccountId);
      if (bank.status !== 'active') throw new AppError(409, 'bank_account_inactive', 'This bank account is inactive');
      const [dupe] = await tx.select().from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.bankAccountId, bankAccountId), eq(bankStatements.contentHash, hash)));
      if (dupe) throw new AppError(409, 'statement_already_imported', `This statement was already imported as ${dupe.statementNo}`, { statementId: dupe.id });
      const [overlap] = await tx.select().from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.bankAccountId, bankAccountId), eq(bankStatements.status, 'active'), sql`daterange(${bankStatements.periodFrom}, ${bankStatements.periodTo}, '[]') && daterange(${input.periodFrom}::date, ${input.periodTo}::date, '[]')`));
      if (overlap) throw new AppError(409, 'statement_overlaps', `This period overlaps ${overlap.statementNo} (${overlap.periodFrom} to ${overlap.periodTo}); void that one first`, { statementId: overlap.id });
      if (bank.clearedThrough && input.periodFrom <= bank.clearedThrough) throw validationFailed([{ path: 'periodFrom', message: `Must be after the account's cleared-through date ${bank.clearedThrough}` }]);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`bank-statement-no:${tenantId}`}, 0))`);
      const [count] = await tx.select({ n: sql<string>`COUNT(*)::text` }).from(bankStatements).where(eq(bankStatements.tenantId, tenantId));
      const statementNo = `BST-${String(Number(count?.n ?? '0') + 1).padStart(6, '0')}`;
      const id = uuidv7();
      const [previous] = await tx.select().from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.bankAccountId, bankAccountId), eq(bankStatements.status, 'active'), sql`${bankStatements.periodTo} < ${input.periodFrom}::date`)).orderBy(sql`${bankStatements.periodTo} DESC`).limit(1);
      const statement = first(await tx.insert(bankStatements).values({ tenantId, id, companyId: bank.companyId, bankAccountId, statementNo, periodFrom: input.periodFrom, periodTo: input.periodTo, openingBalance: fromUnits(opening), closingBalance: fromUnits(closing), lineCount: input.lines.length, contentHash: hash, importedBy: actorId }).returning(), 'Statement');
      const ordered = input.lines.map((l, i) => ({ l, i })).sort((a, b) => (a.l.date < b.l.date ? -1 : a.l.date > b.l.date ? 1 : a.i - b.i));
      const lines = await tx.insert(bankStatementLines).values(ordered.map(({ l }, n) => ({ tenantId, id: uuidv7(), statementId: id, companyId: bank.companyId, bankAccountId, lineNo: n + 1, lineDate: l.date, description: l.description, reference: l.reference ?? null, amount: fromUnits(signedUnits(l.amount)), balance: l.balance ? fromUnits(signedUnits(l.balance)) : null }))).returning();
      await this.recorder.record(tx, tenantId, 'bank_statement', 'imported', statement, { statementNo, bankAccountId, lines: lines.length });
      const gap = previous ? fromUnits(opening - signedUnits(previous.closingBalance)) : null;
      return { statement, lines, continuity: previous ? { previousStatementNo: previous.statementNo, previousClosing: previous.closingBalance, gap } : null };
    });
  }

  voidStatement(tenantId: string, id: string, reason: string): Promise<StatementRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const s = first(await tx.select().from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.id, id))).for('update'), 'Statement');
      if (s.status === 'voided') throw new AppError(409, 'already_voided', 'This statement is already void');
      const [matched] = await tx.select({ id: bankStatementLines.id }).from(bankStatementLines).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.statementId, id), eq(bankStatementLines.status, 'matched'))).limit(1);
      if (matched) throw new AppError(409, 'has_matches', 'Unmatch the statement lines before voiding the statement');
      const row = first(await tx.update(bankStatements).set({ status: 'voided', voidedReason: reason }).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.id, id))).returning(), 'Statement');
      return this.recorder.record(tx, tenantId, 'bank_statement', 'voided', row, { statementNo: row.statementNo, reason });
    });
  }

  listStatements(tenantId: string, bankAccountId: string, limit: number, cursor?: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const after = decodeCursor(cursor);
      const rows = await tx.select().from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.bankAccountId, bankAccountId), after ? sql`${bankStatements.id} > ${after}` : undefined)).orderBy(asc(bankStatements.id)).limit(limit + 1);
      return toPage(rows, limit);
    }, { readOnly: true });
  }

  async getStatement(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const statement = first(await tx.select().from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.id, id))), 'Statement');
      const lines = await tx.select().from(bankStatementLines).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.statementId, id))).orderBy(asc(bankStatementLines.lineNo));
      const [counts] = await tx.select({ matched: sql<number>`count(*) FILTER (WHERE ${bankStatementLines.status} = 'matched')::int`, ignored: sql<number>`count(*) FILTER (WHERE ${bankStatementLines.status} = 'ignored')::int` }).from(bankStatementLines).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.statementId, id)));
      return { statement, lines, matched: counts?.matched ?? 0, ignored: counts?.ignored ?? 0, unmatched: lines.length - (counts?.matched ?? 0) - (counts?.ignored ?? 0) };
    }, { readOnly: true });
  }

  listLines(tenantId: string, q: ListLinesQuery) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const after = decodeCursor(q.cursor);
      const rows = await tx.select().from(bankStatementLines).innerJoin(bankStatements, and(eq(bankStatements.tenantId, bankStatementLines.tenantId), eq(bankStatements.id, bankStatementLines.statementId))).where(and(
        eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.bankAccountId, q.bankAccountId), eq(bankStatements.status, 'active'),
        q.statementId ? eq(bankStatementLines.statementId, q.statementId) : undefined, q.status ? eq(bankStatementLines.status, q.status) : undefined,
        q.from ? sql`${bankStatementLines.lineDate} >= ${q.from}::date` : undefined, q.to ? sql`${bankStatementLines.lineDate} <= ${q.to}::date` : undefined,
        after ? sql`${bankStatementLines.id} > ${after}` : undefined)).orderBy(asc(bankStatementLines.id)).limit(q.limit + 1);
      return toPage(rows.map((r) => r.bank_statement_lines), q.limit);
    }, { readOnly: true });
  }

  async getLine(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const line = first(await tx.select().from(bankStatementLines).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, id))), 'Statement line');
      const matches = await tx.select().from(bankMatches).where(and(eq(bankMatches.tenantId, tenantId), eq(bankMatches.statementLineId, id))).orderBy(asc(bankMatches.id));
      return { line, matches };
    }, { readOnly: true });
  }

  // ---- matching -------------------------------------------------------------------------------------------------------------
  /** Ledger lines on the bank account with no active match (and after the cleared-through date), optionally within a window. */
  private async openLedger(tx: Tx, tenantId: string, bank: BankAccountRow, window?: { from: string; to: string }): Promise<LedgerRow[]> {
    const res = await tx.execute<LedgerRow>(sql`
      SELECT l.id, l.entry_id, e.entry_no, l.posting_date::text AS posting_date, (l.debit - l.credit)::text AS net, COALESCE(l.description, e.description) AS description
        FROM erp.journal_lines l
        JOIN erp.journal_entries e ON e.tenant_id = l.tenant_id AND e.id = l.entry_id
       WHERE l.tenant_id = ${tenantId}::uuid AND l.account_id = ${bank.accountId}::uuid
         AND ${bank.clearedThrough ? sql`l.posting_date > ${bank.clearedThrough}::date` : sql`true`}
         ${window ? sql`AND l.posting_date BETWEEN ${window.from}::date AND ${window.to}::date` : sql``}
         AND NOT EXISTS (SELECT 1 FROM erp.bank_matches m WHERE m.tenant_id = l.tenant_id AND m.journal_line_id = l.id AND m.ended_at IS NULL)
       ORDER BY l.posting_date, l.id`);
    return res.rows;
  }

  private addDays(date: string, n: number): string { return new Date(Date.parse(date) + n * dayMs).toISOString().slice(0, 10); }

  /** Ledger lines that could correspond to a statement line: same amount (exact) or anything unmatched nearby (any). */
  async candidates(tenantId: string, lineId: string, days: number, scope: 'exact' | 'any'): Promise<Candidate[]> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const line = first(await tx.select().from(bankStatementLines).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId))), 'Statement line');
      const bank = await this.account(tx, tenantId, line.bankAccountId);
      const rows = await this.openLedger(tx, tenantId, bank, { from: this.addDays(line.lineDate, -days), to: this.addDays(line.lineDate, days) });
      const want = signedUnits(line.amount);
      return rows
        .filter((r) => scope === 'any' || signedUnits(r.net) === want)
        .map((r) => ({ journalLineId: r.id, entryId: r.entry_id, entryNo: r.entry_no, postingDate: r.posting_date, amount: fromUnits(signedUnits(r.net)), description: r.description, daysApart: daysApart(r.posting_date, line.lineDate) }))
        .sort((a, b) => a.daysApart - b.daysApart || (a.journalLineId < b.journalLineId ? -1 : 1));
    }, { readOnly: true });
  }

  /** Matches one statement line to one or more ledger lines whose total is exactly the line's amount. */
  match(tenantId: string, actorId: string, lineId: string, journalLineIds: string[]) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.matchInTx(tx, tenantId, actorId, lineId, journalLineIds);
      return this.lineView(tx, tenantId, lineId);
    });
  }

  private async lockLine(tx: Tx, tenantId: string, lineId: string): Promise<StatementLineRow> {
    const line = first(await tx.select().from(bankStatementLines).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId))).for('update'), 'Statement line');
    const [s] = await tx.select({ status: bankStatements.status }).from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.id, line.statementId)));
    if (s?.status !== 'active') throw new AppError(409, 'statement_voided', 'This statement is void');
    return line;
  }

  private async matchInTx(tx: Tx, tenantId: string, actorId: string, lineId: string, journalLineIds: string[]): Promise<void> {
    const line = await this.lockLine(tx, tenantId, lineId);
    if (line.status !== 'unmatched') throw new AppError(409, 'line_not_open', `This statement line is already ${line.status}`);
    const bank = await this.account(tx, tenantId, line.bankAccountId);
    const ids = [...new Set(journalLineIds)];
    const rows = await tx.select().from(journalLines).where(and(eq(journalLines.tenantId, tenantId), inArray(journalLines.id, ids)));
    if (rows.length !== ids.length || rows.some((r) => r.accountId !== bank.accountId)) throw validationFailed([{ path: 'journalLineIds', message: 'Every ledger line must exist and be on this bank account' }]);
    const net = rows.map((r) => ({ id: r.id, amount: toUnits(r.debit) - toUnits(r.credit) }));
    const total = net.reduce((a, r) => a + r.amount, 0n);
    if (total !== signedUnits(line.amount)) throw new AppError(422, 'match_amount_mismatch', `The ledger lines total ${fromUnits(total)} but the statement line is ${line.amount}`, { ledgerTotal: fromUnits(total), statementAmount: line.amount });
    const taken = await tx.select({ id: bankMatches.journalLineId }).from(bankMatches).where(and(eq(bankMatches.tenantId, tenantId), inArray(bankMatches.journalLineId, ids), sql`${bankMatches.endedAt} IS NULL`));
    if (taken.length > 0) throw new AppError(409, 'ledger_line_matched', 'A ledger line is already matched to another statement line', { journalLineIds: taken.map((t) => t.id) });
    await tx.insert(bankMatches).values(net.map((r) => ({ tenantId, id: uuidv7(), statementLineId: lineId, journalLineId: r.id, amount: fromUnits(r.amount), matchedBy: actorId })));
    await tx.update(bankStatementLines).set({ status: 'matched', updatedAt: sql`now()` }).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)));
    await this.recorder.record(tx, tenantId, 'bank_statement_line', 'matched', line, { journalLineIds: ids, amount: line.amount });
  }

  private async lineView(tx: Tx, tenantId: string, lineId: string) {
    const line = first(await tx.select().from(bankStatementLines).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId))), 'Statement line');
    const matches = await tx.select().from(bankMatches).where(and(eq(bankMatches.tenantId, tenantId), eq(bankMatches.statementLineId, lineId))).orderBy(asc(bankMatches.id));
    return { line, matches };
  }

  unmatch(tenantId: string, actorId: string, lineId: string, reason: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const line = await this.lockLine(tx, tenantId, lineId);
      if (line.status !== 'matched') throw new AppError(409, 'line_not_matched', 'This statement line is not matched');
      await tx.update(bankMatches).set({ endedAt: sql`now()`, endedBy: actorId, endReason: reason }).where(and(eq(bankMatches.tenantId, tenantId), eq(bankMatches.statementLineId, lineId), sql`${bankMatches.endedAt} IS NULL`));
      await tx.update(bankStatementLines).set({ status: 'unmatched', updatedAt: sql`now()` }).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)));
      await this.recorder.record(tx, tenantId, 'bank_statement_line', 'unmatched', line, { reason });
      return this.lineView(tx, tenantId, lineId);
    });
  }

  /** A bank item that is deliberately not booked (for example a returned-and-re-presented cheque pair). It stays visible in the reconciliation. */
  ignore(tenantId: string, lineId: string, reason: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const line = await this.lockLine(tx, tenantId, lineId);
      if (line.status !== 'unmatched') throw new AppError(409, 'line_not_open', `This statement line is already ${line.status}`);
      await tx.update(bankStatementLines).set({ status: 'ignored', ignoreReason: reason, updatedAt: sql`now()` }).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)));
      await this.recorder.record(tx, tenantId, 'bank_statement_line', 'ignored', line, { reason });
      return this.lineView(tx, tenantId, lineId);
    });
  }

  unignore(tenantId: string, lineId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const line = await this.lockLine(tx, tenantId, lineId);
      if (line.status !== 'ignored') throw new AppError(409, 'line_not_ignored', 'This statement line is not ignored');
      await tx.update(bankStatementLines).set({ status: 'unmatched', ignoreReason: null, updatedAt: sql`now()` }).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.id, lineId)));
      await this.recorder.record(tx, tenantId, 'bank_statement_line', 'unignored', line, {});
      return this.lineView(tx, tenantId, lineId);
    });
  }

  /**
   * Matches the unambiguous ones: a statement line and a ledger line with exactly the same amount, within `days` of each other,
   * where each is the other's only candidate. Anything with more than one possible partner is left for a person to decide.
   */
  autoMatch(tenantId: string, actorId: string, bankAccountId: string, opts: { statementId?: string | undefined; days: number }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const bank = await this.account(tx, tenantId, bankAccountId);
      const lines = await tx.select().from(bankStatementLines).innerJoin(bankStatements, and(eq(bankStatements.tenantId, bankStatementLines.tenantId), eq(bankStatements.id, bankStatementLines.statementId))).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.bankAccountId, bankAccountId), eq(bankStatementLines.status, 'unmatched'), eq(bankStatements.status, 'active'), opts.statementId ? eq(bankStatementLines.statementId, opts.statementId) : undefined)).orderBy(asc(bankStatementLines.lineDate), asc(bankStatementLines.id)).then((r) => r.map((x) => x.bank_statement_lines));
      const ledger = await this.openLedger(tx, tenantId, bank);
      const near = (l: StatementLineRow, g: LedgerRow) => signedUnits(g.net) === signedUnits(l.amount) && daysApart(g.posting_date, l.lineDate) <= opts.days;
      const partners = new Map(lines.map((l) => [l.id, ledger.filter((g) => near(l, g))]));
      const back = new Map(ledger.map((g) => [g.id, lines.filter((l) => near(l, g))]));
      let matched = 0;
      let ambiguous = 0;
      for (const l of lines) {
        const options = partners.get(l.id) ?? [];
        if (options.length === 0) continue;
        const only = options[0];
        if (options.length === 1 && only && (back.get(only.id)?.length ?? 0) === 1) {
          await this.matchInTx(tx, tenantId, actorId, l.id, [only.id]);
          matched++;
        } else ambiguous++;
      }
      return { considered: lines.length, matched, ambiguous, unmatched: lines.length - matched - ambiguous };
    });
  }

  /** Books a bank item the ledger does not have yet (charges, interest) as a journal against the chosen account, and matches it. */
  book(tenantId: string, actorId: string, lineId: string, input: { accountId: string; description?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const line = await this.lockLine(tx, tenantId, lineId);
      if (line.status !== 'unmatched') throw new AppError(409, 'line_not_open', `This statement line is already ${line.status}`);
      const bank = await this.account(tx, tenantId, line.bankAccountId);
      if (input.accountId === bank.accountId) throw validationFailed([{ path: 'accountId', message: 'Must be a different account from the bank account' }]);
      const [other] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, line.companyId), eq(accounts.id, input.accountId)));
      if (!other || other.isGroup || other.status !== 'active' || other.controlKind !== null) throw validationFailed([{ path: 'accountId', message: 'Must be an ordinary, active account of this company' }]);
      const amount = signedUnits(line.amount);
      const abs = fromUnits(amount < 0n ? -amount : amount);
      const text = input.description ?? line.description;
      const { entry, lines } = await this.posting.post(tx, tenantId, {
        companyId: line.companyId, postingDate: line.lineDate, journalType: 'general', description: `Bank: ${text}`.slice(0, 500),
        lines: amount > 0n ? [{ accountId: bank.accountId, debit: abs, description: text }, { accountId: input.accountId, credit: abs, description: text }] : [{ accountId: input.accountId, debit: abs, description: text }, { accountId: bank.accountId, credit: abs, description: text }],
        source: { type: 'bank_statement_line', id: line.id, event: 'book' }, postedBy: actorId,
      });
      const bankLine = lines.find((l) => l.accountId === bank.accountId);
      if (!bankLine) throw new AppError(500, 'internal', 'The bank leg of the entry is missing');
      await this.matchInTx(tx, tenantId, actorId, lineId, [bankLine.id]);
      return { ...(await this.lineView(tx, tenantId, lineId)), entry: { id: entry.id, entryNo: entry.entryNo, postingDate: entry.postingDate } };
    });
  }

  // ---- the reconciliation statement ---------------------------------------------------------------------------------------
  /**
   * The bank reconciliation as of a date: the book balance, less deposits the bank has not yet shown, plus payments it has not yet
   * paid out, plus bank items the books do not have, must equal the bank's own closing balance. `difference` is what remains
   * unexplained (it is zero when the statement is fully matched).
   */
  reconciliation(tenantId: string, bankAccountId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const bank = await this.account(tx, tenantId, bankAccountId);
      const [bookRow] = (await tx.execute<{ net: string }>(sql`SELECT COALESCE(SUM(debit - credit), 0)::text AS net FROM erp.journal_lines WHERE tenant_id = ${tenantId}::uuid AND account_id = ${bank.accountId}::uuid AND posting_date <= ${asOf}::date`)).rows;
      const books = signedUnits(bookRow?.net ?? '0');
      const [latest] = await tx.select().from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.bankAccountId, bankAccountId), eq(bankStatements.status, 'active'), sql`${bankStatements.periodTo} <= ${asOf}::date`)).orderBy(sql`${bankStatements.periodTo} DESC`).limit(1);
      const [first1] = await tx.select().from(bankStatements).where(and(eq(bankStatements.tenantId, tenantId), eq(bankStatements.bankAccountId, bankAccountId), eq(bankStatements.status, 'active'))).orderBy(sql`${bankStatements.periodFrom} ASC`).limit(1);
      // ledger lines to this date that the bank has not shown: no active match to a statement line dated on or before the date
      const uncleared = (await tx.execute<LedgerRow>(sql`
        SELECT l.id, l.entry_id, e.entry_no, l.posting_date::text AS posting_date, (l.debit - l.credit)::text AS net, COALESCE(l.description, e.description) AS description
          FROM erp.journal_lines l JOIN erp.journal_entries e ON e.tenant_id = l.tenant_id AND e.id = l.entry_id
         WHERE l.tenant_id = ${tenantId}::uuid AND l.account_id = ${bank.accountId}::uuid AND l.posting_date <= ${asOf}::date
           AND ${bank.clearedThrough ? sql`l.posting_date > ${bank.clearedThrough}::date` : sql`true`}
           AND NOT EXISTS (SELECT 1 FROM erp.bank_matches m JOIN erp.bank_statement_lines s ON s.tenant_id = m.tenant_id AND s.id = m.statement_line_id
                            WHERE m.tenant_id = l.tenant_id AND m.journal_line_id = l.id AND m.ended_at IS NULL AND s.line_date <= ${asOf}::date)
         ORDER BY l.posting_date, l.id`)).rows;
      const view = (r: LedgerRow) => ({ journalLineId: r.id, entryNo: r.entry_no, postingDate: r.posting_date, amount: fromUnits(signedUnits(r.net)), description: r.description });
      const inTransit = uncleared.filter((r) => signedUnits(r.net) > 0n);
      const outstanding = uncleared.filter((r) => signedUnits(r.net) < 0n);
      const sumOf = (rows: LedgerRow[]) => rows.reduce((a, r) => a + signedUnits(r.net), 0n);
      const bankItems = await tx.select().from(bankStatementLines).innerJoin(bankStatements, and(eq(bankStatements.tenantId, bankStatementLines.tenantId), eq(bankStatements.id, bankStatementLines.statementId))).where(and(eq(bankStatementLines.tenantId, tenantId), eq(bankStatementLines.bankAccountId, bankAccountId), eq(bankStatements.status, 'active'), sql`${bankStatementLines.status} <> 'matched'`, sql`${bankStatementLines.lineDate} <= ${asOf}::date`)).orderBy(asc(bankStatementLines.lineDate), asc(bankStatementLines.id)).then((r) => r.map((x) => x.bank_statement_lines));
      const unbooked = bankItems.filter((l) => l.status === 'unmatched');
      const ignored = bankItems.filter((l) => l.status === 'ignored');
      const sumLines = (rows: StatementLineRow[]) => rows.reduce((a, r) => a + signedUnits(r.amount), 0n);
      const expected = books - sumOf(uncleared) + sumLines(bankItems);
      const statementBalance = latest ? signedUnits(latest.closingBalance) : null;
      let opening: { statementNo: string; openingBalance: string; booksThroughClearedDate: string; difference: string } | null = null;
      if (first1 && bank.clearedThrough) {
        const [o] = (await tx.execute<{ net: string }>(sql`SELECT COALESCE(SUM(debit - credit), 0)::text AS net FROM erp.journal_lines WHERE tenant_id = ${tenantId}::uuid AND account_id = ${bank.accountId}::uuid AND posting_date <= ${bank.clearedThrough}::date`)).rows;
        const b = signedUnits(o?.net ?? '0');
        opening = { statementNo: first1.statementNo, openingBalance: first1.openingBalance, booksThroughClearedDate: fromUnits(b), difference: fromUnits(signedUnits(first1.openingBalance) - b) };
      }
      return {
        bankAccountId, asOf, clearedThrough: bank.clearedThrough,
        balancePerBooks: fromUnits(books),
        depositsInTransit: { total: fromUnits(sumOf(inTransit)), items: inTransit.map(view) },
        outstandingPayments: { total: fromUnits(-sumOf(outstanding)), items: outstanding.map(view) },
        bankItemsNotInBooks: { total: fromUnits(sumLines(unbooked)), items: unbooked.map((l) => ({ statementLineId: l.id, date: l.lineDate, description: l.description, reference: l.reference, amount: l.amount })) },
        ignoredBankItems: { total: fromUnits(sumLines(ignored)), items: ignored.map((l) => ({ statementLineId: l.id, date: l.lineDate, description: l.description, amount: l.amount, reason: l.ignoreReason })) },
        expectedStatementBalance: fromUnits(expected),
        statement: latest ? { statementNo: latest.statementNo, asOf: latest.periodTo, closingBalance: latest.closingBalance } : null,
        difference: statementBalance === null ? null : fromUnits(statementBalance - expected),
        reconciled: statementBalance !== null && statementBalance === expected,
        fullyMatched: unbooked.length === 0,
        openingCheck: opening,
      };
    }, { readOnly: true, isolation: 'repeatable read' });
  }
}
