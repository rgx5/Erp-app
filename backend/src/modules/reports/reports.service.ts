import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';

export const GROUPS = ['item', 'category', 'brand', 'day', 'month', 'cashier', 'customer'] as const;
export type Group = (typeof GROUPS)[number];

/** What each way of grouping shows: the value rows are grouped by, and the name shown for it. Fixed fragments only, never user text. */
const BY: Record<Group, { key: SQL; label: SQL }> = {
  item: { key: sql`l.item_id::text`, label: sql`it.code || ' · ' || it.name` },
  category: { key: sql`COALESCE(it.category_id::text, '')`, label: sql`COALESCE(c.name, 'No category')` },
  brand: { key: sql`COALESCE(it.brand, '')`, label: sql`COALESCE(NULLIF(it.brand, ''), 'No brand')` },
  day: { key: sql`i.invoice_date::text`, label: sql`i.invoice_date::text` },
  month: { key: sql`to_char(i.invoice_date, 'YYYY-MM')`, label: sql`to_char(i.invoice_date, 'YYYY-MM')` },
  cashier: { key: sql`COALESCE(ps.created_by::text, '')`, label: sql`COALESCE(u.display_name, 'Back office')` },
  customer: { key: sql`i.customer_id::text`, label: sql`i.customer_name` },
};

export interface SalesRow { key: string; label: string; quantity: string; net: string; tax: string; total: string; cost: string; profit: string; marginPercent: string | null }

/** Reports read straight from the posted documents: nothing is stored, so they can never drift from the books. */
@Injectable()
export class ReportsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork) {}

  /** Sales by item, category, brand, day, month, cashier or customer. Credit notes count against sales, debit notes with them. */
  async sales(tenantId: string, q: { companyId: string; from: string; to: string; groupBy: Group; categoryId?: string | undefined; limit: number }) {
    const g = BY[q.groupBy];
    const order = q.groupBy === 'day' || q.groupBy === 'month' ? sql`1 ASC` : sql`net DESC`;
    const rows = await this.uow.inTenant(tenantId, async (tx) => (await tx.execute<{ key: string; label: string; quantity: string; net: string; tax: string; total: string; cost: string }>(sql`
      SELECT ${g.key} AS key, ${g.label} AS label,
             SUM(sg.s * l.quantity)::text AS quantity,
             SUM(sg.s * l.taxable_value)::text AS net,
             SUM(sg.s * (l.cgst_amount + l.sgst_amount + l.igst_amount + l.cess_amount))::text AS tax,
             SUM(sg.s * l.line_total)::text AS total,
             SUM(sg.s * COALESCE(l.cost_value, 0))::text AS cost
        FROM erp.sales_invoice_lines l
        JOIN erp.sales_invoices i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
        CROSS JOIN LATERAL (SELECT CASE WHEN i.document_type = 'credit_note' THEN -1 ELSE 1 END AS s) sg
        LEFT JOIN erp.items it ON it.tenant_id = l.tenant_id AND it.id = l.item_id
        LEFT JOIN erp.item_categories c ON c.tenant_id = it.tenant_id AND c.id = it.category_id
        LEFT JOIN erp.pos_sales ps ON ps.tenant_id = i.tenant_id AND ps.document_id = i.id
        LEFT JOIN erp.users u ON u.tenant_id = ps.tenant_id AND u.id = ps.created_by
       WHERE i.tenant_id = ${tenantId}::uuid AND i.company_id = ${q.companyId}::uuid AND i.status = 'posted'
         AND i.invoice_date BETWEEN ${q.from}::date AND ${q.to}::date
         ${q.categoryId ? sql`AND it.category_id = ${q.categoryId}::uuid` : sql``}
       GROUP BY 1, 2
       ORDER BY ${order}
       LIMIT ${q.limit}`)).rows);
    const out: SalesRow[] = rows.map((r) => {
      const net = Number(r.net); const cost = Number(r.cost);
      const profit = net - cost;
      return { ...r, profit: profit.toFixed(2), marginPercent: net > 0 && cost !== 0 ? ((profit / net) * 100).toFixed(1) : null };
    });
    const sum = (k: 'net' | 'tax' | 'total' | 'cost'): number => rows.reduce((s, r) => s + Number(r[k]), 0);
    return { from: q.from, to: q.to, groupBy: q.groupBy, rows: out, totals: { net: sum('net').toFixed(2), tax: sum('tax').toFixed(2), total: sum('total').toFixed(2), cost: sum('cost').toFixed(2), profit: (sum('net') - sum('cost')).toFixed(2) } };
  }

  /** One day at the counters: bills, returns, takings by payment mode and each shift's cash result. */
  async dayEnd(tenantId: string, q: { companyId: string; date: string; terminalId?: string | undefined }) {
    const term = q.terminalId ? sql`AND ps.terminal_id = ${q.terminalId}::uuid` : sql``;
    return this.uow.inTenant(tenantId, async (tx) => {
      const docs = (await tx.execute<{ kind: string; bills: number; net: string; tax: string; total: string }>(sql`
        SELECT ps.kind, COUNT(*)::int AS bills, COALESCE(SUM(i.taxable_total), 0)::text AS net,
               COALESCE(SUM(i.cgst_total + i.sgst_total + i.igst_total + i.cess_total), 0)::text AS tax, COALESCE(SUM(i.grand_total), 0)::text AS total
          FROM erp.pos_sales ps JOIN erp.sales_invoices i ON i.tenant_id = ps.tenant_id AND i.id = ps.document_id
         WHERE ps.tenant_id = ${tenantId}::uuid AND ps.company_id = ${q.companyId}::uuid AND i.invoice_date = ${q.date}::date AND i.status = 'posted' ${term}
         GROUP BY ps.kind`)).rows;
      const pay = (await tx.execute<{ kind: string; method: string; amount: string }>(sql`
        SELECT ps.kind, p.method, SUM(p.amount)::text AS amount
          FROM erp.pos_payments p JOIN erp.pos_sales ps ON ps.tenant_id = p.tenant_id AND ps.id = p.pos_sale_id
          JOIN erp.sales_invoices i ON i.tenant_id = ps.tenant_id AND i.id = ps.document_id
         WHERE ps.tenant_id = ${tenantId}::uuid AND ps.company_id = ${q.companyId}::uuid AND i.invoice_date = ${q.date}::date AND i.status = 'posted' ${term}
         GROUP BY ps.kind, p.method ORDER BY p.method`)).rows;
      const shifts = (await tx.execute<{ id: string; shiftNo: string; terminal: string; cashier: string; openedAt: string; closedAt: string | null; status: string; openingCash: string; expectedCash: string | null; countedCash: string | null; variance: string | null }>(sql`
        SELECT s.id, s.shift_no AS "shiftNo", t.name AS terminal, u.display_name AS cashier, s.opened_at AS "openedAt", s.closed_at AS "closedAt", s.status,
               s.opening_cash::text AS "openingCash", s.expected_cash::text AS "expectedCash", s.counted_cash::text AS "countedCash", s.variance::text AS variance
          FROM erp.pos_shifts s JOIN erp.pos_terminals t ON t.tenant_id = s.tenant_id AND t.id = s.terminal_id
          LEFT JOIN erp.users u ON u.tenant_id = s.tenant_id AND u.id = s.opened_by
         WHERE s.tenant_id = ${tenantId}::uuid AND s.company_id = ${q.companyId}::uuid AND ((s.opened_at AT TIME ZONE 'Asia/Kolkata')::date = ${q.date}::date
                OR EXISTS (SELECT 1 FROM erp.pos_sales x JOIN erp.sales_invoices xi ON xi.tenant_id = x.tenant_id AND xi.id = x.document_id
                            WHERE x.tenant_id = s.tenant_id AND x.shift_id = s.id AND xi.invoice_date = ${q.date}::date))
           ${q.terminalId ? sql`AND s.terminal_id = ${q.terminalId}::uuid` : sql``}
         ORDER BY s.opened_at`)).rows;
      const top = (await tx.execute<{ label: string; quantity: string; net: string }>(sql`
        SELECT it.code || ' · ' || it.name AS label, SUM(l.quantity)::text AS quantity, SUM(l.taxable_value)::text AS net
          FROM erp.pos_sales ps JOIN erp.sales_invoices i ON i.tenant_id = ps.tenant_id AND i.id = ps.document_id AND ps.kind = 'sale'
          JOIN erp.sales_invoice_lines l ON l.tenant_id = i.tenant_id AND l.invoice_id = i.id JOIN erp.items it ON it.tenant_id = l.tenant_id AND it.id = l.item_id
         WHERE ps.tenant_id = ${tenantId}::uuid AND ps.company_id = ${q.companyId}::uuid AND i.invoice_date = ${q.date}::date AND i.status = 'posted' ${term}
         GROUP BY 1 ORDER BY SUM(l.taxable_value) DESC LIMIT 5`)).rows;
      const d = (k: string) => docs.find((x) => x.kind === k) ?? { bills: 0, net: '0', tax: '0', total: '0' };
      const taken = new Map<string, number>();
      for (const p of pay) taken.set(p.method, (taken.get(p.method) ?? 0) + (p.kind === 'return' ? -1 : 1) * Number(p.amount));
      const sale = d('sale'); const ret = d('return');
      return {
        date: q.date,
        sales: { bills: sale.bills, net: sale.net, tax: sale.tax, total: sale.total },
        returns: { bills: ret.bills, net: ret.net, tax: ret.tax, total: ret.total },
        netSales: (Number(sale.total) - Number(ret.total)).toFixed(2),
        byPaymentMode: [...taken.entries()].map(([method, amount]) => ({ method, amount: amount.toFixed(2) })),
        shifts, topItems: top,
      };
    });
  }

  /** Items at or below their reorder level across the company's warehouses, with how much to buy and what is already on order. */
  async lowStock(tenantId: string, q: { companyId: string }) {
    const rows = await this.uow.inTenant(tenantId, async (tx) => (await tx.execute<{ itemId: string; code: string; name: string; reorderLevel: string; reorderQty: string | null; onHand: string; onOrder: string; lastCost: string | null; supplierId: string | null }>(sql`
      SELECT it.id AS "itemId", it.code, it.name, it.reorder_level::text AS "reorderLevel", it.reorder_qty::text AS "reorderQty",
             COALESCE(b.qty, 0)::text AS "onHand", COALESCE(o.qty, 0)::text AS "onOrder", b.last_cost::text AS "lastCost", NULL::text AS "supplierId"
        FROM erp.items it
        LEFT JOIN LATERAL (SELECT SUM(quantity) AS qty, MAX(last_cost) AS last_cost FROM erp.stock_balances sb
                            WHERE sb.tenant_id = it.tenant_id AND sb.company_id = ${q.companyId}::uuid AND sb.item_id = it.id) b ON true
        LEFT JOIN LATERAL (SELECT SUM(GREATEST(pl.quantity - pl.quantity_received, 0)) AS qty FROM erp.purchase_order_lines pl
                             JOIN erp.purchase_orders po ON po.tenant_id = pl.tenant_id AND po.id = pl.order_id
                            WHERE pl.tenant_id = it.tenant_id AND pl.item_id = it.id AND po.company_id = ${q.companyId}::uuid AND po.status IN ('open', 'partially_received')) o ON true
       WHERE it.tenant_id = ${tenantId}::uuid AND it.status = 'active' AND it.is_stocked AND it.reorder_level IS NOT NULL
         AND COALESCE(b.qty, 0) <= it.reorder_level
       ORDER BY (COALESCE(b.qty, 0) - it.reorder_level) ASC, it.code
       LIMIT 1000`)).rows);
    return {
      rows: rows.map((r) => {
        const target = r.reorderQty && Number(r.reorderQty) > 0 ? Number(r.reorderQty) : Math.max(Number(r.reorderLevel) - Number(r.onHand), 0);
        const suggested = Math.max(target - Number(r.onOrder), 0);
        return { itemId: r.itemId, code: r.code, name: r.name, onHand: r.onHand, reorderLevel: r.reorderLevel, onOrder: r.onOrder, suggestedQty: String(suggested), lastCost: r.lastCost };
      }),
    };
  }
}
