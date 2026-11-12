import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { businessLocations } from '../organization/organization.schema.js';
import { accounts, journalCounters, journalEntries, journalLines } from './accounting.schema.js';
import type { ListEntriesQuery } from './accounting.schemas.js';
import { fromUnits, toUnits } from './money.js';
import { PeriodsService } from './periods.service.js';

export type EntryRow = typeof journalEntries.$inferSelect;
export type LineRow = typeof journalLines.$inferSelect;

export interface PostingLine {
  accountId: string;
  debit?: string | undefined;
  credit?: string | undefined;
  description?: string | undefined;
  businessLocationId?: string | undefined;
  partyId?: string | undefined;
}

/**
 * Everything a posting needs. This is the ONLY way entries are created: the manual-journal API and every future subledger
 * (sales, purchases, stock, payroll...) call `PostingService.post` inside their own transaction, so a document and its ledger
 * entry commit or roll back together.
 */
export interface PostingRequest {
  companyId: string;
  postingDate: string;
  journalType: 'general' | 'opening' | 'adjustment' | 'reversal' | 'system';
  description: string;
  lines: PostingLine[];
  /** Who/what caused it. `manual` entries come from people; anything else names the source document and event. */
  source: { type: string; id?: string; event?: string };
  postedBy?: string | undefined;
  reverses?: { entryId: string; reason: string };
}

const PREFIX: Record<PostingRequest['journalType'], string> = { general: 'JV', opening: 'OB', adjustment: 'AJ', reversal: 'RV', system: 'SY' };
const yy = (date: string): string => date.slice(2, 4);

@Injectable()
export class PostingService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PeriodsService) private readonly periods: PeriodsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  /**
   * Posts one balanced entry atomically. Checks, in order: line shape and exact balance; accounts belong to the company, are
   * active and postable (and not subledger-controlled when the source is a person); the date falls in an OPEN period (locked
   * against concurrent closes); then writes header + lines + audit + event. The database re-checks balance, period and account
   * rules at commit, so a bug here cannot produce a bad ledger.
   *
   * A non-manual source that was already posted returns the existing entry (`replayed: true`) instead of posting twice.
   */
  async post(tx: Tx, tenantId: string, request: PostingRequest): Promise<{ entry: EntryRow; lines: LineRow[]; replayed: boolean }> {
    const manual = request.source.type === 'manual';
    if (!manual) {
      const [existing] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.sourceType, request.source.type), eq(journalEntries.sourceId, request.source.id ?? ''), eq(journalEntries.sourceEvent, request.source.event ?? 'post')));
      if (existing) return { entry: existing, lines: await this.linesOf(tx, tenantId, existing.id), replayed: true };
    }

    // 1. shape and exact balance
    if (request.lines.length < 2 || request.lines.length > 500) throw validationFailed([{ path: 'lines', message: 'An entry needs between 2 and 500 lines' }]);
    let debit = 0n;
    let credit = 0n;
    const normalised = request.lines.map((line, index) => {
      const d = line.debit === undefined ? 0n : toUnits(line.debit);
      const c = line.credit === undefined ? 0n : toUnits(line.credit);
      if ((d > 0n) === (c > 0n)) throw validationFailed([{ path: `lines.${index}`, message: 'Each line needs exactly one positive amount, debit or credit' }]);
      debit += d;
      credit += c;
      return { line, d, c };
    });
    if (debit !== credit) throw new AppError(422, 'entry_not_balanced', `Debits (${fromUnits(debit)}) and credits (${fromUnits(credit)}) must be equal`, { debit: fromUnits(debit), credit: fromUnits(credit) });

    // 2. accounts
    const ids = [...new Set(request.lines.map((l) => l.accountId))];
    const found = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, request.companyId), inArray(accounts.id, ids)));
    const byId = new Map(found.map((a) => [a.id, a]));
    request.lines.forEach((line, index) => {
      const account = byId.get(line.accountId);
      const path = `lines.${index}.accountId`;
      if (!account) throw validationFailed([{ path, message: 'This account does not exist in this company' }]);
      if (account.isGroup) throw new AppError(422, 'account_not_postable', `${account.code} ${account.name} is a group account; post to one of its sub-accounts`);
      if (account.status !== 'active') throw new AppError(422, 'account_not_postable', `${account.code} ${account.name} is inactive`);
      if (manual && account.controlKind) throw new AppError(422, 'control_account', `${account.code} ${account.name} is a control account; it is posted only by its subledger, not by manual journals`);
    });
    const locations = [...new Set(request.lines.map((l) => l.businessLocationId).filter((v): v is string => !!v))];
    if (locations.length > 0) {
      const valid = await tx.select({ id: businessLocations.id }).from(businessLocations).where(and(eq(businessLocations.tenantId, tenantId), eq(businessLocations.companyId, request.companyId), inArray(businessLocations.id, locations)));
      if (valid.length !== locations.length) throw validationFailed([{ path: 'lines', message: 'A business location does not belong to this company' }]);
    }

    // 3. period (row locked FOR SHARE until commit)
    const { period, fiscalYear } = await this.periods.openPeriodFor(tx, tenantId, request.companyId, request.postingDate);

    // 4. number: per company x fiscal year x journal type. Taken in this transaction, so a rolled-back posting returns it.
    const [counter] = await tx
      .insert(journalCounters)
      .values({ tenantId, companyId: request.companyId, fiscalYearId: fiscalYear.id, journalType: request.journalType, nextValue: 2 })
      .onConflictDoUpdate({ target: [journalCounters.tenantId, journalCounters.companyId, journalCounters.fiscalYearId, journalCounters.journalType], set: { nextValue: sql`${journalCounters.nextValue} + 1` } })
      .returning({ next: journalCounters.nextValue });
    const sequence = (counter?.next ?? 2) - 1;
    const entryNo = `${PREFIX[request.journalType]}/${yy(fiscalYear.startDate)}${yy(fiscalYear.endDate)}/${String(sequence).padStart(6, '0')}`;

    // 5. write
    const entry = first(
      await tx
        .insert(journalEntries)
        .values({
          tenantId, id: uuidv7(), companyId: request.companyId, fiscalYearId: fiscalYear.id, periodId: period.id, entryNo, journalType: request.journalType,
          sourceType: request.source.type, sourceId: request.source.id ?? null, sourceEvent: request.source.event ?? 'post',
          postingDate: request.postingDate, description: request.description, totalDebit: fromUnits(debit), totalCredit: fromUnits(credit), lineCount: request.lines.length,
          reversesEntryId: request.reverses?.entryId ?? null, reversalReason: request.reverses?.reason ?? null, postedBy: request.postedBy ?? null,
        })
        .returning(),
      'Journal entry',
    );
    const lines = await tx
      .insert(journalLines)
      .values(
        normalised.map(({ line, d, c }, i) => ({
          tenantId, id: uuidv7(), entryId: entry.id, companyId: request.companyId, lineNo: i + 1, accountId: line.accountId, postingDate: request.postingDate,
          debit: fromUnits(d), credit: fromUnits(c), description: line.description ?? null, businessLocationId: line.businessLocationId ?? null, partyId: line.partyId ?? null,
        })),
      )
      .returning();
    await this.recorder.record(tx, tenantId, 'journal_entry', 'posted', entry, {
      entryNo, companyId: request.companyId, journalType: request.journalType, postingDate: request.postingDate, total: entry.totalDebit, sourceType: request.source.type, ...(request.source.id ? { sourceId: request.source.id } : {}),
    });
    return { entry, lines, replayed: false };
  }

  /**
   * Corrects an entry by posting its mirror image (debits and credits swapped) dated `postingDate`. The original is never
   * touched. An entry can be reversed once; a reversal cannot be reversed (post a fresh entry instead); entries created by a
   * document can only be reversed through that document (`allowSystem` is for those flows).
   */
  async reverse(tx: Tx, tenantId: string, entryId: string, input: { postingDate: string; reason: string; postedBy?: string; allowSystem?: boolean }) {
    // Serialise concurrent reversals of the same entry. (Journal rows cannot be locked with FOR UPDATE: the runtime role has no
    // UPDATE privilege on them, which is the point. The unique reversal key remains the final guarantee.)
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`reverse:${tenantId}:${entryId}`}, 0))`);
    const original = first(await tx.select().from(journalEntries).where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.id, entryId))), 'Journal entry');
    if (original.journalType === 'reversal') throw new AppError(409, 'cannot_reverse_reversal', 'A reversing entry cannot itself be reversed; post a new entry instead');
    if (original.sourceType !== 'manual' && !input.allowSystem) throw new AppError(409, 'system_entry', `This entry was created by ${original.sourceType} ${original.sourceId ?? ''}; reverse it through that document`);
    const [already] = await tx.select({ id: journalEntries.id, entryNo: journalEntries.entryNo }).from(journalEntries).where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.reversesEntryId, entryId)));
    if (already) throw new AppError(409, 'already_reversed', `This entry was already reversed by ${already.entryNo}`);
    if (input.postingDate < original.postingDate) throw validationFailed([{ path: 'postingDate', message: 'A reversal cannot be dated before the entry it reverses' }]);
    const originalLines = await this.linesOf(tx, tenantId, entryId);
    return this.post(tx, tenantId, {
      companyId: original.companyId,
      postingDate: input.postingDate,
      journalType: 'reversal',
      description: `Reversal of ${original.entryNo}: ${input.reason}`,
      lines: originalLines.map((l) => ({
        accountId: l.accountId,
        ...(l.credit !== '0.0000' ? { debit: l.credit } : { credit: l.debit }),
        description: l.description ?? undefined,
        businessLocationId: l.businessLocationId ?? undefined,
        partyId: l.partyId ?? undefined,
      })),
      source: { type: 'reversal', id: entryId },
      postedBy: input.postedBy,
      reverses: { entryId, reason: input.reason },
    });
  }

  // ---- reads ----------------------------------------------------------------------------------------------------
  private linesOf(tx: Tx, tenantId: string, entryId: string): Promise<LineRow[]> {
    return tx.select().from(journalLines).where(and(eq(journalLines.tenantId, tenantId), eq(journalLines.entryId, entryId))).orderBy(asc(journalLines.lineNo));
  }

  getEntry(tenantId: string, id: string) {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const entry = first(await tx.select().from(journalEntries).where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.id, id))), 'Journal entry');
        const [reversal] = await tx.select({ id: journalEntries.id, entryNo: journalEntries.entryNo }).from(journalEntries).where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.reversesEntryId, id)));
        return { entry, lines: await this.linesOf(tx, tenantId, id), reversedBy: reversal ?? null };
      },
      { readOnly: true },
    );
  }

  /** Newest first. */
  listEntries(tenantId: string, q: ListEntriesQuery) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const rows = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              eq(journalEntries.companyId, q.companyId),
              before ? lt(journalEntries.id, before) : undefined,
              q.from ? gte(journalEntries.postingDate, q.from) : undefined,
              q.to ? lte(journalEntries.postingDate, q.to) : undefined,
              q.journalType ? eq(journalEntries.journalType, q.journalType) : undefined,
              q.sourceType ? eq(journalEntries.sourceType, q.sourceType) : undefined,
              q.accountId ? sql`EXISTS (SELECT 1 FROM erp.journal_lines l WHERE l.tenant_id = ${tenantId}::uuid AND l.entry_id = ${journalEntries.id} AND l.account_id = ${q.accountId}::uuid)` : undefined,
            ),
          )
          .orderBy(desc(journalEntries.id))
          .limit(q.limit + 1);
        const items = rows.slice(0, q.limit);
        const last = items.at(-1);
        return { items, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
      },
      { readOnly: true },
    );
  }

  /**
   * Trial balance for a date range: per postable account the opening balance (everything before `from`), the period's debits and
   * credits, and the closing balance, each balance shown on its natural side. Totals must balance; `balanced` reports it.
   */
  trialBalance(tenantId: string, companyId: string, from: string, to: string) {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const result = await tx.execute<{ id: string; code: string; name: string; type: string; opening: string; debit: string; credit: string }>(sql`
          SELECT a.id, a.code, a.name, a.type,
                 COALESCE(SUM(l.debit - l.credit) FILTER (WHERE l.posting_date < ${from}::date), 0)::text AS opening,
                 COALESCE(SUM(l.debit) FILTER (WHERE l.posting_date >= ${from}::date), 0)::text AS debit,
                 COALESCE(SUM(l.credit) FILTER (WHERE l.posting_date >= ${from}::date), 0)::text AS credit
            FROM erp.accounts a
            LEFT JOIN erp.journal_lines l ON l.tenant_id = a.tenant_id AND l.company_id = a.company_id AND l.account_id = a.id AND l.posting_date <= ${to}::date
           WHERE a.tenant_id = ${tenantId}::uuid AND a.company_id = ${companyId}::uuid AND NOT a.is_group
           GROUP BY a.id, a.code, a.name, a.type
           ORDER BY a.code`);
        const side = (net: bigint) => ({ debit: net > 0n ? fromUnits(net) : '0.0000', credit: net < 0n ? fromUnits(-net) : '0.0000' });
        let totals = { openingDebit: 0n, openingCredit: 0n, debit: 0n, credit: 0n, closingDebit: 0n, closingCredit: 0n };
        const rows = result.rows
          .map((r) => {
            const opening = toNet(r.opening);
            const debit = toUnits(r.debit);
            const credit = toUnits(r.credit);
            return { ...r, openingNet: opening, debitU: debit, creditU: credit, closingNet: opening + debit - credit };
          })
          .filter((r) => r.openingNet !== 0n || r.debitU !== 0n || r.creditU !== 0n)
          .map((r) => {
            const o = side(r.openingNet);
            const c = side(r.closingNet);
            totals = {
              openingDebit: totals.openingDebit + toUnits(o.debit), openingCredit: totals.openingCredit + toUnits(o.credit),
              debit: totals.debit + r.debitU, credit: totals.credit + r.creditU,
              closingDebit: totals.closingDebit + toUnits(c.debit), closingCredit: totals.closingCredit + toUnits(c.credit),
            };
            return { accountId: r.id, code: r.code, name: r.name, type: r.type, openingDebit: o.debit, openingCredit: o.credit, debit: fromUnits(r.debitU), credit: fromUnits(r.creditU), closingDebit: c.debit, closingCredit: c.credit };
          });
        return {
          companyId, from, to, rows,
          totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, fromUnits(v)])),
          balanced: totals.openingDebit === totals.openingCredit && totals.debit === totals.credit && totals.closingDebit === totals.closingCredit,
        };
      },
      { readOnly: true, isolation: 'repeatable read' }, // one snapshot: totals cannot disagree with rows
    );
  }

  /** One account's lines in a date range with a running balance (debit positive), starting from the balance before `from`. */
  accountLedger(tenantId: string, companyId: string, accountId: string, from: string, to: string, limit: number) {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const account = first(await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, accountId))), 'Account');
        const opening = await tx.execute<{ net: string }>(sql`
          SELECT COALESCE(SUM(debit - credit), 0)::text AS net FROM erp.journal_lines
           WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND account_id = ${accountId}::uuid AND posting_date < ${from}::date`);
        const lines = await tx.execute<{ entry_id: string; entry_no: string; posting_date: string; description: string | null; entry_description: string; debit: string; credit: string; balance: string }>(sql`
          SELECT * FROM (
            SELECT l.entry_id, e.entry_no, l.posting_date::text AS posting_date, l.description, e.description AS entry_description, l.debit::text AS debit, l.credit::text AS credit,
                   (${opening.rows[0]?.net ?? '0'}::numeric + SUM(l.debit - l.credit) OVER (ORDER BY l.posting_date, e.id, l.line_no))::text AS balance,
                   l.posting_date AS d, e.id AS e_id, l.line_no
              FROM erp.journal_lines l JOIN erp.journal_entries e ON e.tenant_id = l.tenant_id AND e.id = l.entry_id
             WHERE l.tenant_id = ${tenantId}::uuid AND l.company_id = ${companyId}::uuid AND l.account_id = ${accountId}::uuid
               AND l.posting_date >= ${from}::date AND l.posting_date <= ${to}::date
          ) x ORDER BY d, e_id, line_no LIMIT ${limit + 1}`);
        const rows = lines.rows.slice(0, limit).map((r) => ({ entryId: r.entry_id, entryNo: r.entry_no, postingDate: r.posting_date, description: r.description ?? r.entry_description, debit: r.debit, credit: r.credit, balance: r.balance }));
        return { account: { id: account.id, code: account.code, name: account.name, type: account.type }, from, to, openingBalance: fromSigned(toNet(opening.rows[0]?.net ?? '0')), lines: rows, hasMore: lines.rows.length > limit };
      },
      { readOnly: true, isolation: 'repeatable read' },
    );
  }
}

/** A signed numeric string from SQL (`-12.3400`) as integer units. */
function toNet(value: string): bigint {
  return value.startsWith('-') ? -toUnits(value.slice(1)) : toUnits(value);
}
const fromSigned = (units: bigint): string => fromUnits(units);
