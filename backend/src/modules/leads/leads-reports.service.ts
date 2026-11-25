import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError } from '../../platform/http/errors.js';
import { Recorder } from '../masterdata/helpers.js';

const num = (v: unknown): number => Number(v ?? 0);

@Injectable()
export class LeadsReportsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(Recorder) private readonly recorder: Recorder) {}

  /** Leads, wins and money by where they came from, with what was spent on adverts: the numbers that say which source pays. */
  summary(tenantId: string, from: string, to: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = (await tx.execute<{ source: string; campaign: string; leads: number; open: number; won: number; lost: number; avg_response: string | null; revenue: string }>(sql`
        WITH l AS (SELECT * FROM erp.leads WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${from}::date AND created_at < ${to}::date + 1 AND duplicate_of IS NULL),
        rev AS (
          SELECT l.id AS lead_id, SUM(CASE WHEN i.document_type = 'credit_note' THEN -i.grand_total ELSE i.grand_total END) AS amt
          FROM l JOIN erp.sales_invoices i ON i.tenant_id = l.tenant_id AND i.customer_id = l.party_id AND i.status = 'posted' AND i.invoice_date >= l.created_at::date
          WHERE l.party_id IS NOT NULL GROUP BY l.id)
        SELECT l.source, COALESCE(l.campaign, '') AS campaign, count(*)::int AS leads, count(*) FILTER (WHERE l.status = 'open')::int AS open, count(*) FILTER (WHERE l.status = 'won')::int AS won, count(*) FILTER (WHERE l.status = 'lost')::int AS lost,
          avg(extract(epoch FROM (l.first_response_at - l.created_at)) / 60) FILTER (WHERE l.first_response_at IS NOT NULL) AS avg_response, COALESCE(sum(rev.amt), 0) AS revenue
        FROM l LEFT JOIN rev ON rev.lead_id = l.id GROUP BY 1, 2`)).rows;
      const spend = (await tx.execute<{ source: string; campaign: string; amount: string }>(sql`SELECT source, campaign, sum(amount) AS amount FROM erp.lead_ad_spend WHERE tenant_id = ${tenantId}::uuid AND spend_date BETWEEN ${from}::date AND ${to}::date GROUP BY 1, 2`)).rows;
      type Row = { source: string; campaign: string; leads: number; open: number; won: number; lost: number; avgResponseMinutes: number | null; revenue: number; spend: number; costPerLead: number | null; costPerWon: number | null; winRate: number | null };
      const map = new Map<string, Row>();
      const key = (s: string, c: string): string => `${s}|${c.toLowerCase()}`;
      const blank = (source: string, campaign: string): Row => ({ source, campaign, leads: 0, open: 0, won: 0, lost: 0, avgResponseMinutes: null, revenue: 0, spend: 0, costPerLead: null, costPerWon: null, winRate: null });
      for (const r of rows) map.set(key(r.source, r.campaign), { ...blank(r.source, r.campaign), leads: r.leads, open: r.open, won: r.won, lost: r.lost, avgResponseMinutes: r.avg_response === null ? null : Math.round(num(r.avg_response) * 10) / 10, revenue: num(r.revenue) });
      for (const s of spend) { const k = key(s.source, s.campaign); const cur = map.get(k) ?? blank(s.source, s.campaign); cur.spend += num(s.amount); map.set(k, cur); }
      const items = [...map.values()].map((r) => ({ ...r, costPerLead: r.spend > 0 && r.leads > 0 ? Math.round((r.spend / r.leads) * 100) / 100 : null, costPerWon: r.spend > 0 && r.won > 0 ? Math.round((r.spend / r.won) * 100) / 100 : null, winRate: r.won + r.lost > 0 ? Math.round((r.won / (r.won + r.lost)) * 1000) / 10 : null }))
        .sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source));
      const sum = (f: (r: Row) => number): number => items.reduce((s, r) => s + f(r), 0);
      const stages = (await tx.execute<{ name: string; kind: string; position: number; n: number }>(sql`SELECT s.name, s.kind, s.position, count(l.id)::int AS n FROM erp.lead_stages s LEFT JOIN erp.leads l ON l.tenant_id = s.tenant_id AND l.stage_id = s.id AND l.created_at >= ${from}::date AND l.created_at < ${to}::date + 1 AND l.duplicate_of IS NULL WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'active' GROUP BY s.name, s.kind, s.position ORDER BY s.position`)).rows;
      const sla = (await tx.execute<{ answered: number; in_time: number; overdue: number; waiting: number }>(sql`SELECT count(*) FILTER (WHERE first_response_at IS NOT NULL)::int AS answered, count(*) FILTER (WHERE first_response_at IS NOT NULL AND first_response_at <= sla_due_at)::int AS in_time,
        count(*) FILTER (WHERE status = 'open' AND first_response_at IS NULL AND sla_due_at < now())::int AS overdue, count(*) FILTER (WHERE status = 'open' AND first_response_at IS NULL)::int AS waiting FROM erp.leads WHERE tenant_id = ${tenantId}::uuid AND created_at >= ${from}::date AND created_at < ${to}::date + 1 AND duplicate_of IS NULL`)).rows[0];
      const lostWhy = (await tx.execute<{ reason: string; n: number }>(sql`SELECT COALESCE(lost_reason, 'Not said') AS reason, count(*)::int AS n FROM erp.leads WHERE tenant_id = ${tenantId}::uuid AND status = 'lost' AND created_at >= ${from}::date AND created_at < ${to}::date + 1 AND duplicate_of IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)).rows;
      const totalSpend = sum((r) => r.spend);
      return {
        from, to, items,
        totals: { leads: sum((r) => r.leads), won: sum((r) => r.won), lost: sum((r) => r.lost), open: sum((r) => r.open), revenue: sum((r) => r.revenue), spend: totalSpend, costPerLead: totalSpend > 0 && sum((r) => r.leads) > 0 ? Math.round((totalSpend / sum((r) => r.leads)) * 100) / 100 : null },
        funnel: stages.map((s) => ({ name: s.name, kind: s.kind, count: s.n })),
        response: { answered: sla?.answered ?? 0, withinSla: sla?.in_time ?? 0, overdue: sla?.overdue ?? 0, waiting: sla?.waiting ?? 0 },
        lostReasons: lostWhy.map((r) => ({ reason: r.reason, count: r.n })),
      };
    }, { readOnly: true });
  }

  listSpend(tenantId: string, from: string, to: string) {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.execute<{ id: string; spend_date: string; source: string; campaign: string; amount: string; impressions: number | null; clicks: number | null; note: string | null }>(sql`SELECT id, to_char(spend_date, 'YYYY-MM-DD') AS spend_date, source, campaign, amount, impressions, clicks, note FROM erp.lead_ad_spend WHERE tenant_id = ${tenantId}::uuid AND spend_date BETWEEN ${from}::date AND ${to}::date ORDER BY spend_date DESC, source, campaign LIMIT 1000`)).rows.map((r) => ({ id: r.id, date: r.spend_date, source: r.source, campaign: r.campaign, amount: r.amount, impressions: r.impressions, clicks: r.clicks, note: r.note })), { readOnly: true });
  }

  /** One day's spend for a source and campaign; entering the same day again replaces it, so a corrected figure never doubles. */
  saveSpend(tenantId: string, actorId: string, rows: { date: string; source: string; campaign?: string | undefined; amount: string; impressions?: number | undefined; clicks?: number | undefined; note?: string | undefined }[]) {
    return this.uow.inTenant(tenantId, async (tx) => {
      for (const r of rows) {
        await tx.execute(sql`INSERT INTO erp.lead_ad_spend (tenant_id, id, spend_date, source, campaign, amount, impressions, clicks, note, created_by) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${r.date}::date, ${r.source}, ${(r.campaign ?? '').trim()}, ${r.amount}, ${r.impressions ?? null}, ${r.clicks ?? null}, ${r.note ?? null}, ${actorId}::uuid)
          ON CONFLICT (tenant_id, spend_date, source, campaign) DO UPDATE SET amount = EXCLUDED.amount, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks, note = EXCLUDED.note`);
      }
      await this.recorder.record(tx, tenantId, 'lead_ad_spend', 'saved', { id: tenantId }, { rows: rows.length });
      return { saved: rows.length };
    });
  }

  removeSpend(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const r = await tx.execute(sql`DELETE FROM erp.lead_ad_spend WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      if ((r.rowCount ?? 0) === 0) throw new AppError(404, 'not_found', 'That entry does not exist');
      return { ok: true };
    });
  }
}
