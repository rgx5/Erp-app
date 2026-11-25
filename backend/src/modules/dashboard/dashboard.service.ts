import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { ChangeBus } from '../../platform/events/change-bus.js';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { fiscalYears } from '../accounting/accounting.schema.js';
import { fromUnits, toUnits } from '../accounting/money.js';
import { StatementsService } from '../accounting/statements.service.js';
import { divRound } from '../inventory/decimal.js';
import { ReceivablesService } from '../sales/receivables.service.js';
import { PayablesService } from '../purchasing/payables.service.js';

const units = (t: string): bigint => (t.startsWith('-') ? -toUnits(t.slice(1)) : toUnits(t));
const monthOf = (d: string): string => d.slice(0, 7);
const firstOfMonth = (d: string): string => `${monthOf(d)}-01`;
const lastOfMonth = (month: string): string => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
const addMonths = (month: string, n: number): string => {
  const total = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

interface Result { revenue: bigint; expenses: bigint }

/** One screen's worth of numbers for an owner, all derived from the ledger and the subledgers (nothing is stored). */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(StatementsService) private readonly statements: StatementsService,
    @Inject(ReceivablesService) private readonly receivables: ReceivablesService,
    @Inject(PayablesService) private readonly payables: PayablesService,
    @Inject(ENV) env: Env,
    @Inject(ChangeBus) bus: ChangeBus,
  ) {
    this.ttl = env.DASHBOARD_CACHE_TTL_MS;
    bus.subscribeAll((tenantId) => this.forget(tenantId));
  }
  private readonly ttl: number;

  private async result(tx: Tx, tenantId: string, companyId: string, from: string, to: string): Promise<Result> {
    const rows = await this.statements.nets(tx, tenantId, companyId, { from, to }, true, ['income', 'expense']);
    let revenue = 0n;
    let expenses = 0n;
    for (const r of rows) if (r.type === 'income') revenue -= r.net; else expenses += r.net;
    return { revenue, expenses };
  }

  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();
  /** The dashboard is the heaviest screen people open most: keep each answer for a few seconds, and drop it the moment anything changes for that client. */
  summary(tenantId: string, companyId: string, asOf: string): ReturnType<DashboardService['compute']> {
    const key = `${tenantId}|${companyId}|${asOf}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < this.ttl) return hit.value as ReturnType<DashboardService['compute']>;
    const value = this.compute(tenantId, companyId, asOf);
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, { at: Date.now(), value });
    value.catch(() => this.cache.delete(key));
    return value;
  }
  /** Called when the client's data changes. */
  forget(tenantId: string): void { for (const k of this.cache.keys()) if (k.startsWith(`${tenantId}|`)) this.cache.delete(k); }

  async compute(tenantId: string, companyId: string, asOf: string) {
    const core = await this.uow.inTenant(tenantId, async (tx) => {
      const [fy] = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.companyId, companyId), sql`${fiscalYears.startDate} <= ${asOf}::date AND ${fiscalYears.endDate} >= ${asOf}::date`));
      if (!fy) throw new AppError(409, 'no_fiscal_year', `No fiscal year covers ${asOf}`);
      const month = monthOf(asOf);
      const monthStart = firstOfMonth(asOf) < fy.startDate ? fy.startDate : firstOfMonth(asOf);
      const prevMonth = addMonths(month, -1);
      const prevStart = firstOfMonth(`${prevMonth}-01`) < fy.startDate ? null : `${prevMonth}-01`;

      const thisMonth = await this.result(tx, tenantId, companyId, monthStart, asOf);
      const previous = prevStart ? await this.result(tx, tenantId, companyId, prevStart, lastOfMonth(prevMonth)) : null;
      const ytd = await this.result(tx, tenantId, companyId, fy.startDate, asOf);

      const trend: { month: string; revenue: string; expenses: string; profit: string }[] = [];
      for (let m = monthOf(fy.startDate); m <= month; m = addMonths(m, 1)) {
        const from = m === monthOf(fy.startDate) ? fy.startDate : `${m}-01`;
        const to = m === month ? asOf : lastOfMonth(m);
        const r = await this.result(tx, tenantId, companyId, from, to);
        trend.push({ month: m, revenue: fromUnits(r.revenue), expenses: fromUnits(r.expenses), profit: fromUnits(r.revenue - r.expenses) });
      }

      const assets = await this.statements.nets(tx, tenantId, companyId, { to: asOf }, false, ['asset']);
      const cashAccounts = assets.filter((a) => a.lineCode === 'BS.CASH' && a.net !== 0n);
      const inv = (await tx.execute<{ net: string }>(sql`SELECT COALESCE(SUM(l.debit - l.credit), 0)::text AS net FROM erp.journal_lines l JOIN erp.accounts a ON a.tenant_id = l.tenant_id AND a.id = l.account_id WHERE l.tenant_id = ${tenantId}::uuid AND l.company_id = ${companyId}::uuid AND a.control_kind = 'inventory' AND l.posting_date <= ${asOf}::date`)).rows[0];
      const count = async (query: ReturnType<typeof sql>): Promise<number> => Number((await tx.execute<{ n: string }>(query)).rows[0]?.n ?? 0);
      const attention = {
        pendingApprovals: await count(sql`SELECT count(*)::text AS n FROM erp.approval_requests WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND status = 'pending'`),
        unmatchedBankLines: await count(sql`SELECT count(*)::text AS n FROM erp.bank_statement_lines l JOIN erp.bank_statements s ON s.tenant_id = l.tenant_id AND s.id = l.statement_id WHERE l.tenant_id = ${tenantId}::uuid AND l.company_id = ${companyId}::uuid AND l.status = 'unmatched' AND s.status = 'active'`),
        openPurchaseOrders: await count(sql`SELECT count(*)::text AS n FROM erp.purchase_orders WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND status IN ('open', 'partially_received')`),
        openWorkOrders: await count(sql`SELECT count(*)::text AS n FROM erp.work_orders WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND status IN ('planned', 'released', 'in_progress')`),
      };
      const view = (r: Result) => ({ revenue: fromUnits(r.revenue), expenses: fromUnits(r.expenses), profit: fromUnits(r.revenue - r.expenses) });
      const margin = (r: Result): string | null => (r.revenue > 0n ? fromUnits(divRound((r.revenue - r.expenses) * 1_000_000n, r.revenue)).slice(0, -2) : null);
      return {
        companyId, asOf,
        fiscalYear: { id: fy.id, label: fy.label, startDate: fy.startDate, endDate: fy.endDate },
        cash: { total: fromUnits(cashAccounts.reduce((a, c) => a + c.net, 0n)), accounts: cashAccounts.map((c) => ({ accountId: c.id, code: c.code, name: c.name, balance: fromUnits(c.net) })) },
        month: { from: monthStart, ...view(thisMonth), ...(previous ? { previousMonth: view(previous) } : {}) },
        yearToDate: { from: fy.startDate, ...view(ytd), netMarginPercent: margin(ytd) },
        inventoryValue: fromUnits(units(inv?.net ?? '0')),
        trend,
        attention,
      };
    }, { readOnly: true, isolation: 'repeatable read' });

    const sales = await this.receivables.ageing(tenantId, companyId, asOf);
    const purchases = await this.payables.ageing(tenantId, companyId, asOf);
    const side = (t: Record<string, string>) => { const total = t['total'] ?? '0.0000'; const current = t['current'] ?? '0.0000'; return { total, current, overdue: fromUnits(units(total) - units(current)) }; };
    return { ...core, receivables: side(sales.totals), payables: side(purchases.totals) };
  }
}
