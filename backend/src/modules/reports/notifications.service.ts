import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { ReceivablesService } from '../sales/receivables.service.js';
import { ReportsService } from './reports.service.js';

export interface Notice { id: string; severity: 'info' | 'warn' | 'bad'; title: string; detail: string; to: string; count: number }
export interface Allowed { can: (perm: string) => boolean; has: (module: string) => boolean }

const today = (): string => new Date().toISOString().slice(0, 10);
const TTL_MS = 60_000;

/** Things that need someone's attention, worked out from the records when asked (nothing is stored). Each is shown only to people who may act on it and whose plan includes it. */
@Injectable()
export class NotificationsService {
  private readonly ageingCache = new Map<string, { at: number; value: { customers: number; amount: number } }>();

  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(ReceivablesService) private readonly receivables: ReceivablesService,
    @Inject(ReportsService) private readonly reports: ReportsService,
  ) {}

  private async overdue(tenantId: string, companyId: string): Promise<{ customers: number; amount: number }> {
    const key = `${tenantId}:${companyId}`; const hit = this.ageingCache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const a = await this.receivables.ageing(tenantId, companyId, today());
    const rows = a.customers.map((c) => { const b = c as unknown as Record<string, string>; return Number(b['days1to30'] ?? 0) + Number(b['days31to60'] ?? 0) + Number(b['days61to90'] ?? 0) + Number(b['over90'] ?? 0); }).filter((x) => x > 0);
    const value = { customers: rows.length, amount: rows.reduce((s, x) => s + x, 0) };
    this.ageingCache.set(key, { at: Date.now(), value });
    return value;
  }

  async list(tenantId: string, companyId: string, who: Allowed, licenceExpiresAt?: string | null): Promise<Notice[]> {
    const out: Notice[] = [];
    const n = async (query: ReturnType<typeof sql>): Promise<number> => this.uow.inTenant(tenantId, async (tx) => Number((await tx.execute<{ n: string }>(query)).rows[0]?.n ?? 0), { readOnly: true });
    if (who.can('approvals:decide')) {
      const c = await n(sql`SELECT count(*)::text AS n FROM erp.approval_requests WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND status = 'pending'`);
      if (c > 0) out.push({ id: 'approvals', severity: 'warn', title: `${c} approval${c === 1 ? '' : 's'} waiting for you`, detail: 'Documents are held until a manager decides.', to: '/approvals', count: c });
    }
    if (who.can('stock:read') && who.has('inventory')) {
      const c = (await this.reports.lowStock(tenantId, { companyId })).rows.length;
      if (c > 0) out.push({ id: 'low_stock', severity: 'warn', title: `${c} item${c === 1 ? ' is' : 's are'} low on stock`, detail: 'At or below the reorder level you set.', to: '/inventory/reorder', count: c });
    }
    if (who.can('receivables:read') && who.has('sales')) {
      const o = await this.overdue(tenantId, companyId);
      if (o.customers > 0) out.push({ id: 'overdue', severity: 'bad', title: `${o.customers} customer${o.customers === 1 ? ' has' : 's have'} overdue payments`, detail: `${o.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })} rupees overdue in total.`, to: '/sales/reminders', count: o.customers });
    }
    if (who.can('pos:read') && who.has('pos')) {
      const c = await n(sql`SELECT count(*)::text AS n FROM erp.pos_shifts WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND status = 'open' AND opened_at < now() - interval '16 hours'`);
      if (c > 0) out.push({ id: 'shift_open', severity: 'warn', title: `${c} shift${c === 1 ? ' has' : 's have'} been open for over 16 hours`, detail: 'Close the shift and count the drawer.', to: '/pos/admin', count: c });
    }
    if (who.can('sales:read') && who.has('sales')) {
      const failed = await n(sql`SELECT count(*)::text AS n FROM erp.recurring_invoices WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND status = 'active' AND last_error IS NOT NULL`);
      if (failed > 0) out.push({ id: 'recurring_failed', severity: 'bad', title: `${failed} recurring invoice${failed === 1 ? ' could' : 's could'} not be raised`, detail: 'Open the schedule to see why.', to: '/sales/recurring', count: failed });
      const due = await n(sql`SELECT count(*)::text AS n FROM erp.recurring_invoices WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND status = 'active' AND last_error IS NULL AND next_run_date <= ${today()}::date`);
      if (due > 0) out.push({ id: 'recurring_due', severity: 'info', title: `${due} recurring invoice${due === 1 ? ' is' : 's are'} due`, detail: 'They are raised when someone opens the app, or press "Raise due invoices now".', to: '/sales/recurring', count: due });
    }
    if (who.can('leads:read') && who.has('leads')) {
      const late = await n(sql`SELECT count(*)::text AS n FROM erp.leads WHERE tenant_id = ${tenantId}::uuid AND status = 'open' AND first_response_at IS NULL AND sla_due_at < now()`);
      if (late > 0) out.push({ id: 'leads_late', severity: 'bad', title: `${late} new lead${late === 1 ? ' has' : 's have'} not been contacted in time`, detail: 'Call them: the first few minutes decide whether an enquiry becomes a sale.', to: '/leads', count: late });
      const follow = await n(sql`SELECT count(*)::text AS n FROM erp.leads WHERE tenant_id = ${tenantId}::uuid AND status = 'open' AND next_follow_up_at < now()`);
      if (follow > 0) out.push({ id: 'leads_follow_up', severity: 'warn', title: `${follow} lead follow-up${follow === 1 ? ' is' : 's are'} overdue`, detail: 'A task you planned has passed its date.', to: '/leads', count: follow });
    }
    if (licenceExpiresAt) {
      const days = Math.ceil((Date.parse(licenceExpiresAt) - Date.now()) / 86_400_000);
      if (days <= 14) out.push({ id: 'licence', severity: days <= 3 ? 'bad' : 'warn', title: days < 0 ? 'Your licence has expired' : `Your licence ends in ${days} day${days === 1 ? '' : 's'}`, detail: 'Ask your administrator to renew it.', to: '/account', count: 1 });
    }
    return out;
  }
}
