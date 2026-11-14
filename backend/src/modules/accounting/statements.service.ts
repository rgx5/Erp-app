import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { validationFailed } from '../../platform/http/errors.js';
import { accounts, accountingSettings, statementMappings } from './accounting.schema.js';
import { fromUnits, toUnits } from './money.js';
import { Recorder, first } from '../masterdata/helpers.js';
import { ALL_LINES, BALANCE_SHEET_LINES, DEFAULT_MAPPING, PROFIT_LOSS_LINES, lineByCode, profitLoss, type AccountType } from './schedule3.js';

const signed = (t: string): bigint => (t.startsWith('-') ? -toUnits(t.slice(1)) : toUnits(t));
const money = (u: bigint): string => fromUnits(u);
const FALLBACK: Record<AccountType, string> = { asset: 'BS.OTHER_CA', liability: 'BS.OTHER_CL', equity: 'BS.RESERVES', income: 'PL.OTHER_INCOME', expense: 'PL.OTHER_EXPENSES' };

export interface AccountNet { id: string; code: string; name: string; type: AccountType; net: bigint }
interface LineOut { code: string; label: string; amount: string; accounts: { accountId: string; code: string; name: string; amount: string }[] }

/** Schedule III statements computed from the ledger and the editable account-to-line mapping. */
@Injectable()
export class StatementsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- settings and mapping -------------------------------------------------------------------------------------------------
  getSettings(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.select().from(accountingSettings).where(and(eq(accountingSettings.tenantId, tenantId), eq(accountingSettings.companyId, companyId))))[0] ?? null, { readOnly: true });
  }
  putSettings(tenantId: string, companyId: string, input: { retainedEarningsAccountId?: string | null | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (input.retainedEarningsAccountId) {
        const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, input.retainedEarningsAccountId)));
        if (!a || a.isGroup || a.status !== 'active' || a.type !== 'equity' || a.controlKind) throw validationFailed([{ path: 'retainedEarningsAccountId', message: 'Must be an active, ordinary equity account of this company' }]);
      }
      const [existing] = await tx.select().from(accountingSettings).where(and(eq(accountingSettings.tenantId, tenantId), eq(accountingSettings.companyId, companyId))).for('update');
      const row = existing
        ? first(await tx.update(accountingSettings).set({ retainedEarningsAccountId: input.retainedEarningsAccountId ?? null }).where(and(eq(accountingSettings.tenantId, tenantId), eq(accountingSettings.companyId, companyId))).returning(), 'Settings')
        : first(await tx.insert(accountingSettings).values({ tenantId, companyId, retainedEarningsAccountId: input.retainedEarningsAccountId ?? null }).returning(), 'Settings');
      await this.recorder.record(tx, tenantId, 'accounting_settings', 'updated', { id: companyId }, { companyId });
      return row;
    });
  }

  /** Every postable account with its statement line (or none), so the gaps are visible. */
  mapping(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await this.mapped(tx, tenantId, companyId);
      return { lines: ALL_LINES.map((l) => ({ code: l.code, label: l.label, accountTypes: l.accountTypes })), accounts: rows.map((r) => ({ accountId: r.id, code: r.code, name: r.name, type: r.type, lineCode: r.lineCode })), unmapped: rows.filter((r) => !r.lineCode).map((r) => r.code) };
    }, { readOnly: true });
  }
  putMapping(tenantId: string, companyId: string, items: { accountId: string; lineCode: string }[]) {
    return this.uow.inTenant(tenantId, async (tx) => {
      for (const [i, it] of items.entries()) {
        const line = lineByCode.get(it.lineCode);
        if (!line) throw validationFailed([{ path: `items.${i}.lineCode`, message: 'Unknown statement line' }]);
        const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, it.accountId)));
        if (!a || a.isGroup) throw validationFailed([{ path: `items.${i}.accountId`, message: 'A postable account of this company is needed' }]);
        if (!line.accountTypes.includes(a.type as AccountType)) throw validationFailed([{ path: `items.${i}.lineCode`, message: `${a.code} is a ${a.type} account; ${line.label} takes ${line.accountTypes.join('/')} accounts` }]);
        await tx.insert(statementMappings).values({ tenantId, companyId, accountId: it.accountId, lineCode: it.lineCode }).onConflictDoUpdate({ target: [statementMappings.tenantId, statementMappings.companyId, statementMappings.accountId], set: { lineCode: it.lineCode, updatedAt: new Date() } });
      }
      await this.recorder.record(tx, tenantId, 'statement_mapping', 'updated', { id: companyId }, { companyId, accounts: items.length });
      return this.mappingIn(tx, tenantId, companyId);
    });
  }
  /** Maps the accounts of the template chart (by code) that are not mapped yet. */
  applyTemplate(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await this.mapped(tx, tenantId, companyId);
      let n = 0;
      for (const r of rows) {
        const line = DEFAULT_MAPPING[r.code];
        if (r.lineCode || !line || !lineByCode.get(line)?.accountTypes.includes(r.type)) continue;
        await tx.insert(statementMappings).values({ tenantId, companyId, accountId: r.id, lineCode: line }).onConflictDoNothing();
        n++;
      }
      await this.recorder.record(tx, tenantId, 'statement_mapping', 'template_applied', { id: companyId }, { companyId, mapped: n });
      return this.mappingIn(tx, tenantId, companyId);
    });
  }
  private mappingIn(tx: Tx, tenantId: string, companyId: string) {
    return this.mapped(tx, tenantId, companyId).then((rows) => ({ accounts: rows.map((r) => ({ accountId: r.id, code: r.code, name: r.name, type: r.type, lineCode: r.lineCode })), unmapped: rows.filter((r) => !r.lineCode).map((r) => r.code) }));
  }
  private async mapped(tx: Tx, tenantId: string, companyId: string) {
    const res = await tx.execute<{ id: string; code: string; name: string; type: AccountType; line_code: string | null }>(sql`
      SELECT a.id, a.code, a.name, a.type, m.line_code FROM erp.accounts a
        LEFT JOIN erp.statement_mappings m ON m.tenant_id = a.tenant_id AND m.company_id = a.company_id AND m.account_id = a.id
       WHERE a.tenant_id = ${tenantId}::uuid AND a.company_id = ${companyId}::uuid AND NOT a.is_group ORDER BY a.code`);
    return res.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, lineCode: r.line_code }));
  }

  // ---- ledger nets -------------------------------------------------------------------------------------------------------------
  /** Per account: debit minus credit, over a date range, optionally leaving out year-end closing entries (and their reversals). */
  async nets(tx: Tx, tenantId: string, companyId: string, range: { from?: string | undefined; to: string }, excludeClosing: boolean, types: AccountType[]): Promise<(AccountNet & { lineCode: string | null })[]> {
    const res = await tx.execute<{ id: string; code: string; name: string; type: AccountType; line_code: string | null; net: string }>(sql`
      SELECT a.id, a.code, a.name, a.type, m.line_code, COALESCE(SUM(l.debit - l.credit), 0)::text AS net
        FROM erp.accounts a
        LEFT JOIN erp.statement_mappings m ON m.tenant_id = a.tenant_id AND m.company_id = a.company_id AND m.account_id = a.id
        LEFT JOIN erp.journal_lines l ON l.tenant_id = a.tenant_id AND l.company_id = a.company_id AND l.account_id = a.id AND l.posting_date <= ${range.to}::date ${range.from ? sql`AND l.posting_date >= ${range.from}::date` : sql``}
          ${excludeClosing ? sql`AND NOT EXISTS (SELECT 1 FROM erp.journal_entries e WHERE e.tenant_id = l.tenant_id AND e.id = l.entry_id AND (e.source_type = 'year_end' OR EXISTS (SELECT 1 FROM erp.journal_entries o WHERE o.tenant_id = e.tenant_id AND o.id = e.reverses_entry_id AND o.source_type = 'year_end')))` : sql``}
       WHERE a.tenant_id = ${tenantId}::uuid AND a.company_id = ${companyId}::uuid AND NOT a.is_group AND a.type = ANY(${sql`ARRAY[${sql.join(types.map((t) => sql`${t}`), sql`, `)}]::text[]`})
       GROUP BY a.id, a.code, a.name, a.type, m.line_code ORDER BY a.code`);
    return res.rows.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, net: signed(r.net), lineCode: r.line_code }));
  }

  private group(rows: (AccountNet & { lineCode: string | null })[], lines: readonly { code: string; label: string }[], sign: 1n | -1n) {
    const known = new Set(lines.map((l) => l.code));
    const out = new Map<string, LineOut & { raw: bigint }>(lines.map((l) => [l.code, { code: l.code, label: l.label, amount: '0.0000', accounts: [], raw: 0n }]));
    const unmapped: string[] = [];
    for (const r of rows) {
      let code = r.lineCode ?? FALLBACK[r.type];
      if (!r.lineCode && r.net !== 0n) unmapped.push(r.code);
      if (!known.has(code)) code = FALLBACK[r.type];
      const l = out.get(code);
      if (!l || r.net === 0n) continue;
      const v = r.net * sign;
      l.raw += v;
      l.accounts.push({ accountId: r.id, code: r.code, name: r.name, amount: money(v) });
    }
    for (const l of out.values()) l.amount = money(l.raw);
    return { lines: out, unmapped };
  }

  // ---- statements -----------------------------------------------------------------------------------------------------------------
  /** Profit and loss for a period, with an optional comparative period. Year-end closing entries never appear in it. */
  profitLoss(tenantId: string, companyId: string, from: string, to: string, compare?: { from: string; to: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const one = async (f: string, t: string) => {
        const rows = await this.nets(tx, tenantId, companyId, { from: f, to: t }, true, ['income', 'expense']);
        const income = this.group(rows.filter((r) => r.type === 'income'), PROFIT_LOSS_LINES.filter((l) => l.accountTypes.includes('income')), -1n);
        const expense = this.group(rows.filter((r) => r.type === 'expense'), PROFIT_LOSS_LINES.filter((l) => l.accountTypes.includes('expense')), 1n);
        const by = (c: string) => income.lines.get(c)?.raw ?? expense.lines.get(c)?.raw ?? 0n;
        return { lines: [...income.lines.values(), ...expense.lines.values()], totals: profitLoss(by), unmapped: [...income.unmapped, ...expense.unmapped] };
      };
      const cur = await one(from, to);
      const prev = compare ? await one(compare.from, compare.to) : null;
      const view = (r: typeof cur) => ({ lines: r.lines.map(({ raw: _r, ...l }) => l), revenueFromOperations: money(r.totals.revenue), otherIncome: money(r.totals.otherIncome), totalRevenue: money(r.totals.totalRevenue), totalExpenses: money(r.totals.totalExpenses), profitBeforeTax: money(r.totals.profitBeforeTax), taxExpense: money(r.totals.tax), profitForThePeriod: money(r.totals.profit) });
      return { companyId, from, to, ...view(cur), unmappedAccounts: [...new Set(cur.unmapped)], ...(prev ? { comparative: { from: compare?.from, to: compare?.to, ...view(prev) } } : {}) };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  /** Balance sheet as of a date. Profit not yet moved to reserves by a year-end close is shown on its own line, so it always balances. */
  balanceSheet(tenantId: string, companyId: string, asOf: string, compareAsOf?: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const one = async (date: string) => {
        const bs = await this.nets(tx, tenantId, companyId, { to: date }, false, ['asset', 'liability', 'equity']);
        const pl = await this.nets(tx, tenantId, companyId, { to: date }, false, ['income', 'expense']);
        const profit = -pl.reduce((a, r) => a + r.net, 0n); // credit minus debit over every income and expense account
        const assets = this.group(bs.filter((r) => r.type === 'asset'), BALANCE_SHEET_LINES.filter((l) => l.accountTypes.includes('asset')), 1n);
        const liab = this.group(bs.filter((r) => r.type !== 'asset'), BALANCE_SHEET_LINES.filter((l) => !l.accountTypes.includes('asset')), -1n);
        const sum = (m: Map<string, { raw: bigint }>) => [...m.values()].reduce((a, l) => a + l.raw, 0n);
        const totalAssets = sum(assets.lines);
        const totalEquityLiabilities = sum(liab.lines) + profit;
        const shareholders = (liab.lines.get('BS.SHARE_CAPITAL')?.raw ?? 0n) + (liab.lines.get('BS.RESERVES')?.raw ?? 0n) + profit;
        return {
          asOf: date,
          equityAndLiabilities: { lines: [...liab.lines.values()].map(({ raw: _r, ...l }) => l), profitAndLossAccount: money(profit), shareholdersFunds: money(shareholders), total: money(totalEquityLiabilities) },
          assets: { lines: [...assets.lines.values()].map(({ raw: _r, ...l }) => l), total: money(totalAssets) },
          balanced: totalAssets === totalEquityLiabilities, difference: money(totalAssets - totalEquityLiabilities), unmappedAccounts: [...new Set([...assets.unmapped, ...liab.unmapped])],
        };
      };
      const cur = await one(asOf);
      const prev = compareAsOf ? await one(compareAsOf) : null;
      return { companyId, ...cur, ...(prev ? { comparative: prev } : {}) };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  /** Cash flow (indirect), derived from the movement in balance-sheet lines between two dates; it must equal the movement in cash. */
  cashFlow(tenantId: string, companyId: string, from: string, to: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const before = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const snap = async (date: string) => {
        const bs = await this.nets(tx, tenantId, companyId, { to: date }, false, ['asset', 'liability', 'equity']);
        const pl = await this.nets(tx, tenantId, companyId, { to: date }, false, ['income', 'expense']);
        const a = this.group(bs.filter((r) => r.type === 'asset'), BALANCE_SHEET_LINES.filter((l) => l.accountTypes.includes('asset')), 1n);
        const l = this.group(bs.filter((r) => r.type !== 'asset'), BALANCE_SHEET_LINES.filter((x) => !x.accountTypes.includes('asset')), -1n);
        const v = (c: string) => a.lines.get(c)?.raw ?? l.lines.get(c)?.raw ?? 0n;
        return { v, profit: -pl.reduce((x, r) => x + r.net, 0n) };
      };
      const open = await snap(before);
      const close = await snap(to);
      const d = (c: string) => close.v(c) - open.v(c);
      const rows = await this.nets(tx, tenantId, companyId, { from, to }, true, ['income', 'expense']);
      const income = this.group(rows.filter((r) => r.type === 'income'), PROFIT_LOSS_LINES.filter((l) => l.accountTypes.includes('income')), -1n);
      const expense = this.group(rows.filter((r) => r.type === 'expense'), PROFIT_LOSS_LINES.filter((l) => l.accountTypes.includes('expense')), 1n);
      const pl = profitLoss((c) => income.lines.get(c)?.raw ?? expense.lines.get(c)?.raw ?? 0n);
      const dep = expense.lines.get('PL.DEPRECIATION')?.raw ?? 0n;
      const workingCapital = -(d('BS.INVENTORIES') + d('BS.RECEIVABLES') + d('BS.ST_LOANS_ADV') + d('BS.OTHER_CA')) + d('BS.TRADE_PAYABLES') + d('BS.OTHER_CL') + d('BS.ST_PROVISIONS') + d('BS.OTHER_LT_LIAB');
      const operating = pl.profit + dep + workingCapital;
      const investing = -(d('BS.PPE') + dep) - (d('BS.INTANGIBLES') + d('BS.CWIP') + d('BS.NC_INVESTMENTS') + d('BS.OTHER_NCA') + d('BS.CURRENT_INVESTMENTS'));
      const equityMovement = d('BS.SHARE_CAPITAL') + d('BS.RESERVES') + (close.profit - open.profit);
      const financing = d('BS.LT_BORROWINGS') + d('BS.ST_BORROWINGS') + (equityMovement - pl.profit);
      const change = d('BS.CASH');
      return {
        companyId, from, to,
        operating: { profitForThePeriod: money(pl.profit), depreciation: money(dep), changeInWorkingCapital: money(workingCapital), net: money(operating) },
        investing: { net: money(investing) }, financing: { borrowings: money(d('BS.LT_BORROWINGS') + d('BS.ST_BORROWINGS')), equityOtherThanProfit: money(equityMovement - pl.profit), net: money(financing) },
        netChangeInCash: money(operating + investing + financing), openingCash: money(open.v('BS.CASH')), closingCash: money(close.v('BS.CASH')), movementInCash: money(change), reconciled: operating + investing + financing === change,
      };
    }, { readOnly: true, isolation: 'repeatable read' });
  }
}
