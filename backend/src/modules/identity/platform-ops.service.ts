import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { AuditService } from '../../platform/services/audit.service.js';
import { moduleProblem } from './entitlements.js';
import { PrincipalCache } from './principal-cache.js';

export interface Check { key: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface TenantSummary {
  id: string; slug: string; name: string; status: string; createdAt: string;
  usage: { users: number; companies: number; locations: number; terminals: number; sites: number; documents30d: number; events30d: number; lastActivityAt: string | null };
  licence: { restricted: boolean; plan: string | null; modules: string[]; limits: Record<string, number>; readOnly: boolean; expiresAt: string | null; source: string | null };
}
const n = (v: unknown): number => Number(v ?? 0);

/**
 * What the platform (the control plane's agent on this server) may ask about every tenant here: who they are, how much they use, whether their data
 * passes basic integrity checks, and the power to suspend or reactivate one. Never business content: counts and pass/fail only.
 */
@Injectable()
export class PlatformOpsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(AuditService) private readonly audit: AuditService, @Inject(PrincipalCache) private readonly cache: PrincipalCache) {}

  /** Every tenant on this server (read from the tenant directory, then each one inside its own context). */
  async listTenants(): Promise<TenantSummary[]> {
    const ids = await this.uow.inTenant('00000000-0000-0000-0000-000000000000', async (tx) => (await tx.execute<{ tenant_id: string }>(sql`SELECT tenant_id FROM erp.tenant_directory ORDER BY slug`)).rows.map((r) => r.tenant_id), { readOnly: true });
    const out: TenantSummary[] = [];
    for (let i = 0; i < ids.length; i += 5) out.push(...(await Promise.all(ids.slice(i, i + 5).map((id) => this.summary(id)))).filter((s): s is TenantSummary => s !== null));
    return out;
  }

  async summary(tenantId: string): Promise<TenantSummary | null> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const t = (await tx.execute<{ id: string; slug: string; name: string; status: string; created_at: string | Date }>(sql`SELECT id, slug, name, status, created_at FROM erp.tenants WHERE id = ${tenantId}::uuid`)).rows[0];
      if (!t) return null;
      const u = (await tx.execute<Record<string, string | null>>(sql`
        SELECT (SELECT count(*) FROM erp.users WHERE status = 'active') AS users,
               (SELECT count(*) FROM erp.companies) AS companies,
               (SELECT count(*) FROM erp.business_locations) AS locations,
               (SELECT count(*) FROM erp.pos_terminals) AS terminals,
               (SELECT count(*) FROM erp.sites) AS sites,
               (SELECT count(*) FROM erp.sales_invoices WHERE invoice_date >= current_date - 30)
                 + (SELECT count(*) FROM erp.supplier_bills WHERE bill_date >= current_date - 30)
                 + (SELECT count(*) FROM erp.pos_sales WHERE created_at >= now() - interval '30 days')
                 + (SELECT count(*) FROM erp.customer_receipts WHERE receipt_date >= current_date - 30) AS documents30d,
               (SELECT count(*) FROM erp.audit_log WHERE occurred_at >= now() - interval '30 days') AS events30d,
               (SELECT max(occurred_at) FROM erp.audit_log) AS last_activity`)).rows[0] ?? {};
      const e = (await tx.execute<{ plan: string | null; modules: string[]; limits: Record<string, number>; read_only: boolean; expires_at: string | Date | null; source: string }>(sql`SELECT plan, modules, limits, read_only, expires_at, source FROM erp.tenant_entitlements WHERE tenant_id = ${tenantId}::uuid`)).rows[0];
      return {
        id: t.id, slug: t.slug, name: t.name, status: t.status, createdAt: new Date(t.created_at).toISOString(),
        usage: { users: n(u['users']), companies: n(u['companies']), locations: n(u['locations']), terminals: n(u['terminals']), sites: n(u['sites']), documents30d: n(u['documents30d']), events30d: n(u['events30d']), lastActivityAt: u['last_activity'] ? new Date(u['last_activity'] as string).toISOString() : null },
        licence: e ? { restricted: true, plan: e.plan, modules: [...e.modules].sort(), limits: e.limits, readOnly: e.read_only, expiresAt: e.expires_at ? new Date(e.expires_at).toISOString() : null, source: e.source } : { restricted: false, plan: null, modules: [], limits: {}, readOnly: false, expiresAt: null, source: null },
      };
    }, { readOnly: true });
  }

  /**
   * How much data one client holds, so the platform can see who is growing and plan capacity: row counts of the tables that grow, and the
   * on-disk size of the tables that hold them (a table is shared by every client on the cell, so size is shown as this client's share of rows).
   */
  async dataUsage(tenantId: string): Promise<{ tenantId: string; at: string; tables: { table: string; rows: number }[]; totalRows: number; oldestRecord: string | null }> {
    const names = ['journal_lines', 'journal_entries', 'sales_invoices', 'sales_invoice_lines', 'supplier_bills', 'pos_sales', 'pos_sale_lines', 'stock_ledger', 'audit_log', 'outbox_events', 'attachments', 'parties', 'items', 'leads'];
    return this.uow.inTenant(tenantId, async (tx) => {
      const tables: { table: string; rows: number }[] = [];
      for (const t of names) {
        const exists = (await tx.execute<{ ok: boolean }>(sql`SELECT to_regclass(${'erp.' + t}) IS NOT NULL AS ok`)).rows[0]?.ok;
        if (!exists) continue;
        tables.push({ table: t, rows: n((await tx.execute<{ c: string }>(sql.raw(`SELECT count(*) AS c FROM erp.${t}`))).rows[0]?.c) });
      }
      const oldest = (await tx.execute<{ at: string | Date | null }>(sql`SELECT min(occurred_at) AS at FROM erp.audit_log`)).rows[0]?.at;
      return { tenantId, at: new Date().toISOString(), tables, totalRows: tables.reduce((a, r) => a + r.rows, 0), oldestRecord: oldest ? new Date(oldest).toISOString() : null };
    }, { readOnly: true });
  }

  /** Integrity and set-up checks for one tenant. Read-only; counts and pass/fail only. */
  async validate(tenantId: string): Promise<{ tenantId: string; at: string; ok: boolean; checks: Check[] }> {
    const checks = await this.uow.inTenant(tenantId, async (tx) => {
      const q = async <T extends Record<string, unknown>>(text: ReturnType<typeof sql>): Promise<T> => (await tx.execute<T>(text)).rows[0] as T;
      const out: Check[] = [];
      const t = await q<{ status: string }>(sql`SELECT status FROM erp.tenants WHERE id = ${tenantId}::uuid`);
      if (!t) throw new AppError(404, 'not_found', 'Tenant not found');
      out.push({ key: 'tenant_active', label: 'Tenant is active', status: t.status === 'active' ? 'pass' : 'warn', detail: t.status });

      const own = await q<{ c: string }>(sql`SELECT count(*) AS c FROM erp.user_roles ur JOIN erp.roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id JOIN erp.users u ON u.tenant_id = ur.tenant_id AND u.id = ur.user_id WHERE ur.revoked_at IS NULL AND u.status = 'active' AND '*' = ANY (r.permissions)`);
      out.push({ key: 'owner_exists', label: 'At least one active owner', status: n(own.c) > 0 ? 'pass' : 'fail', detail: `${n(own.c)} active owner(s)` });

      const led = await q<{ d: string; c: string; l: string }>(sql`SELECT coalesce(sum(debit),0) AS d, coalesce(sum(credit),0) AS c, count(*) AS l FROM erp.journal_lines`);
      out.push({ key: 'ledger_balanced', label: 'Ledger balances (debits equal credits)', status: led.d === led.c ? 'pass' : 'fail', detail: led.d === led.c ? `${n(led.l)} lines balance` : `debits ${led.d} vs credits ${led.c}` });

      const entries = await q<{ bad: string }>(sql`SELECT count(*) AS bad FROM erp.journal_entries e WHERE e.total_debit <> (SELECT coalesce(sum(l.debit),0) FROM erp.journal_lines l WHERE l.tenant_id = e.tenant_id AND l.entry_id = e.id)`);
      out.push({ key: 'entries_match_lines', label: 'Every journal entry matches its lines', status: n(entries.bad) === 0 ? 'pass' : 'fail', detail: n(entries.bad) === 0 ? 'all entries agree' : `${n(entries.bad)} entries differ from their lines` });

      const fy = await q<{ companies: string; missing: string }>(sql`SELECT count(*) AS companies, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM erp.fiscal_years f WHERE f.tenant_id = c.tenant_id AND f.company_id = c.id AND current_date BETWEEN f.start_date AND f.end_date)) AS missing FROM erp.companies c`);
      out.push({ key: 'fiscal_year_current', label: 'Every company has a fiscal year covering today', status: n(fy.missing) === 0 ? 'pass' : 'warn', detail: n(fy.companies) === 0 ? 'no companies yet' : n(fy.missing) === 0 ? `${n(fy.companies)} company(ies) covered` : `${n(fy.missing)} of ${n(fy.companies)} have none` });

      const fyLabel = sql`(CASE WHEN extract(month FROM current_date) >= 4 THEN extract(year FROM current_date)::int ELSE extract(year FROM current_date)::int - 1 END)`;
      const series = await q<{ regs: string; missing: string }>(sql`SELECT count(*) AS regs, count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM erp.number_series s WHERE s.tenant_id = g.tenant_id AND s.gst_registration_id = g.id AND s.document_type = 'tax_invoice' AND s.status = 'active' AND s.financial_year = (${fyLabel})::text || '-' || lpad((((${fyLabel}) + 1) % 100)::text, 2, '0'))) AS missing FROM erp.gst_registrations g WHERE g.status = 'active'`);
      out.push({ key: 'invoice_series', label: 'Every GST registration has this year\'s tax-invoice series', status: n(series.missing) === 0 ? 'pass' : 'fail', detail: n(series.regs) === 0 ? 'no GST registrations' : n(series.missing) === 0 ? `${n(series.regs)} registration(s) covered` : `${n(series.missing)} of ${n(series.regs)} missing a series: invoicing will fail` });

      const ent = await q<{ modules: string[] | null; expires_at: string | Date | null; read_only: boolean | null }>(sql`SELECT modules, expires_at, read_only FROM erp.tenant_entitlements WHERE tenant_id = ${tenantId}::uuid`);
      if (!ent) out.push({ key: 'licence', label: 'Licence', status: 'warn', detail: 'no licence record: unrestricted' });
      else {
        const problem = moduleProblem(ent.modules ?? []);
        out.push({ key: 'licence_modules', label: 'Licensed modules are consistent', status: problem ? 'fail' : 'pass', detail: problem ?? (ent.modules ?? []).join(', ') });
        const days = ent.expires_at ? Math.ceil((new Date(ent.expires_at).getTime() - Date.now()) / 86_400_000) : null;
        out.push({ key: 'licence_expiry', label: 'Licence not about to expire', status: ent.read_only ? 'fail' : days === null ? 'pass' : days < 0 ? 'fail' : days <= 30 ? 'warn' : 'pass', detail: ent.read_only ? 'suspended (read-only)' : days === null ? 'does not expire' : days < 0 ? `expired ${-days} day(s) ago` : `${days} day(s) left` });
      }
      return out;
    }, { readOnly: true });
    return { tenantId, at: new Date().toISOString(), ok: checks.every((c) => c.status !== 'fail'), checks };
  }

  /** Suspends or reactivates a tenant: while suspended nobody can sign in and every session stops working. */
  async setStatus(tenantId: string, status: 'active' | 'suspended', reason: string): Promise<{ id: string; status: string }> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = (await tx.execute<{ id: string; status: string }>(sql`UPDATE erp.tenants SET status = ${status} WHERE id = ${tenantId}::uuid RETURNING id, status`)).rows[0];
      if (!r) throw new AppError(404, 'not_found', 'Tenant not found');
      await this.audit.record(tx, tenantId, { action: `tenant.${status === 'active' ? 'reactivated' : 'suspended'}`, entityType: 'tenant', entityId: tenantId, details: { reason } });
      this.cache.clearTenant(tenantId);
      return r;
    });
  }
}
