import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, lt, lte, sql } from 'drizzle-orm';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { decodeCursor, encodeCursor, toPage } from '../../platform/http/validation.js';
import { toUnits as moneyToUnits } from '../accounting/money.js';
import { first } from '../masterdata/helpers.js';
import { cost, costOf, qty, value } from './decimal.js';
import { stockLedger, stockMovements, stockSerials } from './inventory.schema.js';

/** Read side of the inventory subledger: balances, stock card, valuation, serials, and the GL reconciliation. */
@Injectable()
export class StockQueriesService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork) {}

  getMovement(tenantId: string, id: string) {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const movement = first(await tx.select().from(stockMovements).where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.id, id))), 'Stock movement');
        const lines = await tx.select().from(stockLedger).where(and(eq(stockLedger.tenantId, tenantId), eq(stockLedger.movementId, id))).orderBy(asc(stockLedger.lineNo));
        const serials = await tx.execute<{ ledger_id: string; serial_no: string }>(sql`
          SELECT ls.ledger_id, s.serial_no FROM erp.stock_ledger_serials ls JOIN erp.stock_serials s ON s.tenant_id = ls.tenant_id AND s.id = ls.serial_id
           WHERE ls.tenant_id = ${tenantId}::uuid AND ls.ledger_id IN (SELECT id FROM erp.stock_ledger WHERE tenant_id = ${tenantId}::uuid AND movement_id = ${id}::uuid)`);
        return { movement, lines: lines.map((l) => ({ ...l, serialNos: serials.rows.filter((s) => s.ledger_id === l.id).map((s) => s.serial_no) })) };
      },
      { readOnly: true },
    );
  }

  listMovements(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; from?: string | undefined; to?: string | undefined; movementType?: string | undefined; itemId?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const rows = await tx
          .select()
          .from(stockMovements)
          .where(
            and(
              eq(stockMovements.tenantId, tenantId),
              eq(stockMovements.companyId, q.companyId),
              before ? lt(stockMovements.id, before) : undefined,
              q.from ? gte(stockMovements.postingDate, q.from) : undefined,
              q.to ? lte(stockMovements.postingDate, q.to) : undefined,
              q.movementType ? eq(stockMovements.movementType, q.movementType) : undefined,
              q.itemId ? sql`EXISTS (SELECT 1 FROM erp.stock_ledger l WHERE l.tenant_id = ${tenantId}::uuid AND l.movement_id = ${stockMovements.id} AND l.item_id = ${q.itemId}::uuid)` : undefined,
            ),
          )
          .orderBy(desc(stockMovements.id))
          .limit(q.limit + 1);
        const page = rows.slice(0, q.limit);
        const last = page.at(-1);
        return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
      },
      { readOnly: true },
    );
  }

  /** Current quantity, value and average cost per item per warehouse. */
  balances(tenantId: string, q: { companyId: string; warehouseId?: string | undefined; itemId?: string | undefined; limit: number }) {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const result = await tx.execute<{ warehouse_id: string; warehouse_code: string; item_id: string; item_code: string; item_name: string; costing_method: string; quantity: string; value: string; last_cost: string }>(sql`
          SELECT b.warehouse_id, w.code AS warehouse_code, b.item_id, i.code AS item_code, i.name AS item_name, i.costing_method, b.quantity::text, b.value::text, b.last_cost::text
            FROM erp.stock_balances b
            JOIN erp.items i ON i.tenant_id = b.tenant_id AND i.id = b.item_id
            JOIN erp.warehouses w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
           WHERE b.tenant_id = ${tenantId}::uuid AND b.company_id = ${q.companyId}::uuid
             ${q.warehouseId ? sql`AND b.warehouse_id = ${q.warehouseId}::uuid` : sql``}
             ${q.itemId ? sql`AND b.item_id = ${q.itemId}::uuid` : sql``}
           ORDER BY w.code, i.code LIMIT ${q.limit + 1}`);
        const rows = result.rows.slice(0, q.limit).map((r) => {
          const quantity = qty.parseSigned(r.quantity);
          const val = value.parseSigned(r.value);
          return {
            warehouseId: r.warehouse_id, warehouseCode: r.warehouse_code, itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, costingMethod: r.costing_method,
            quantity: r.quantity, value: r.value, averageCost: quantity > 0n ? cost.format(costOf(val, quantity)) : r.last_cost,
          };
        });
        const batchRows = await tx.execute<{ warehouse_id: string; item_id: string; batch_id: string; batch_no: string; expiry_date: string | null; quantity: string }>(sql`
          SELECT bb.warehouse_id, bb.item_id, bb.batch_id, b.batch_no, b.expiry_date::text, bb.quantity::text
            FROM erp.batch_balances bb JOIN erp.batches b ON b.tenant_id = bb.tenant_id AND b.id = bb.batch_id
           WHERE bb.tenant_id = ${tenantId}::uuid AND bb.quantity > 0
             ${q.warehouseId ? sql`AND bb.warehouse_id = ${q.warehouseId}::uuid` : sql``}
             ${q.itemId ? sql`AND bb.item_id = ${q.itemId}::uuid` : sql``}
           ORDER BY b.expiry_date NULLS LAST, b.batch_no`);
        return { items: rows.map((r) => ({ ...r, batches: batchRows.rows.filter((b) => b.warehouse_id === r.warehouseId && b.item_id === r.itemId).map((b) => ({ batchId: b.batch_id, batchNo: b.batch_no, expiryDate: b.expiry_date, quantity: b.quantity })) })), hasMore: result.rows.length > q.limit };
      },
      { readOnly: true, isolation: 'repeatable read' },
    );
  }

  /** The stock card: every ledger line for an item, oldest first, with the running balance recorded at posting time. */
  stockCard(tenantId: string, q: { companyId: string; itemId: string; warehouseId?: string | undefined; from?: string | undefined; to?: string | undefined; limit: number; cursor?: string | undefined }) {
    const after = decodeCursor(q.cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const rows = await tx
          .select({ l: stockLedger, movementNo: stockMovements.movementNo, movementType: stockMovements.movementType, description: stockMovements.description })
          .from(stockLedger)
          .innerJoin(stockMovements, and(eq(stockMovements.tenantId, stockLedger.tenantId), eq(stockMovements.id, stockLedger.movementId)))
          .where(
            and(
              eq(stockLedger.tenantId, tenantId),
              eq(stockLedger.companyId, q.companyId),
              eq(stockLedger.itemId, q.itemId),
              q.warehouseId ? eq(stockLedger.warehouseId, q.warehouseId) : undefined,
              q.from ? gte(stockLedger.postingDate, q.from) : undefined,
              q.to ? lte(stockLedger.postingDate, q.to) : undefined,
              after ? gt(stockLedger.id, after) : undefined,
            ),
          )
          .orderBy(asc(stockLedger.id))
          .limit(q.limit + 1);
        const page = toPage(rows.map((r) => ({ ...r.l, movementNo: r.movementNo, movementType: r.movementType, description: r.description })), q.limit);
        return page;
      },
      { readOnly: true },
    );
  }

  /** Stock value as of a date, rebuilt from the immutable ledger (not from the cached balances). */
  valuation(tenantId: string, companyId: string, asOf: string) {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const result = await tx.execute<{ warehouse_code: string; item_id: string; item_code: string; item_name: string; item_type: string; costing_method: string; quantity: string; value: string }>(sql`
          SELECT w.code AS warehouse_code, i.id AS item_id, i.code AS item_code, i.name AS item_name, i.item_type, i.costing_method,
                 SUM(l.quantity)::text AS quantity, SUM(l.value)::text AS value
            FROM erp.stock_ledger l
            JOIN erp.items i ON i.tenant_id = l.tenant_id AND i.id = l.item_id
            JOIN erp.warehouses w ON w.tenant_id = l.tenant_id AND w.id = l.warehouse_id
           WHERE l.tenant_id = ${tenantId}::uuid AND l.company_id = ${companyId}::uuid AND l.posting_date <= ${asOf}::date
           GROUP BY w.code, i.id, i.code, i.name, i.item_type, i.costing_method
          HAVING SUM(l.quantity) <> 0 OR SUM(l.value) <> 0
           ORDER BY w.code, i.code`);
        let total = 0n;
        const rows = result.rows.map((r) => {
          const quantity = qty.parseSigned(r.quantity);
          const val = value.parseSigned(r.value);
          total += val;
          return { warehouseCode: r.warehouse_code, itemId: r.item_id, itemCode: r.item_code, itemName: r.item_name, itemType: r.item_type, costingMethod: r.costing_method, quantity: r.quantity, value: r.value, averageCost: quantity > 0n ? cost.format(costOf(val, quantity)) : null };
        });
        return { companyId, asOf, rows, totalValue: value.format(total) };
      },
      { readOnly: true, isolation: 'repeatable read' },
    );
  }

  listSerials(tenantId: string, q: { itemId: string; status?: string | undefined; warehouseId?: string | undefined; limit: number; cursor?: string | undefined }) {
    const after = decodeCursor(q.cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) =>
        toPage(
          await tx
            .select()
            .from(stockSerials)
            .where(and(eq(stockSerials.tenantId, tenantId), eq(stockSerials.itemId, q.itemId), q.status ? eq(stockSerials.status, q.status) : undefined, q.warehouseId ? eq(stockSerials.warehouseId, q.warehouseId) : undefined, after ? gt(stockSerials.id, after) : undefined))
            .orderBy(asc(stockSerials.id))
            .limit(q.limit + 1),
          q.limit,
        ),
      { readOnly: true },
    );
  }

  /**
   * Proves the subledger and the general ledger agree: for each GL account that holds stock, the stock ledger's value (as of the date,
   * for the item types mapped to it) against the account's GL balance. Any difference is reported per account; `reconciled` is true
   * only when every difference is zero. Stock GL accounts that carry a balance but have no item types mapped are listed too.
   */
  reconciliation(tenantId: string, companyId: string, asOf: string) {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const result = await tx.execute<{ account_id: string; code: string; name: string; stock_value: string; gl_balance: string }>(sql`
          WITH stock AS (
            SELECT ia.account_id, COALESCE(SUM(l.value), 0) AS stock_value
              FROM erp.inventory_accounts ia
              LEFT JOIN erp.items i ON i.tenant_id = ia.tenant_id AND i.item_type = ia.item_type
              LEFT JOIN erp.stock_ledger l ON l.tenant_id = i.tenant_id AND l.item_id = i.id AND l.company_id = ia.company_id AND l.posting_date <= ${asOf}::date
             WHERE ia.tenant_id = ${tenantId}::uuid AND ia.company_id = ${companyId}::uuid
             GROUP BY ia.account_id),
          gl AS (
            SELECT l.account_id, SUM(l.debit - l.credit) AS gl_balance
              FROM erp.journal_lines l
             WHERE l.tenant_id = ${tenantId}::uuid AND l.company_id = ${companyId}::uuid AND l.posting_date <= ${asOf}::date
             GROUP BY l.account_id)
          SELECT a.id AS account_id, a.code, a.name, COALESCE(stock.stock_value, 0)::text AS stock_value, COALESCE(gl.gl_balance, 0)::text AS gl_balance
            FROM erp.accounts a
            LEFT JOIN stock ON stock.account_id = a.id
            LEFT JOIN gl ON gl.account_id = a.id
           WHERE a.tenant_id = ${tenantId}::uuid AND a.company_id = ${companyId}::uuid
             AND (stock.account_id IS NOT NULL OR (a.control_kind IN ('inventory', 'work_in_progress') AND COALESCE(gl.gl_balance, 0) <> 0
                AND a.id NOT IN (SELECT grni_account_id FROM erp.purchasing_settings WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND grni_account_id IS NOT NULL)
                AND a.id NOT IN (SELECT wip_account_id FROM erp.manufacturing_settings WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND wip_account_id IS NOT NULL))) -- GRNI and WIP are reconciled by their own reports
           ORDER BY a.code`);
        let stockTotal = 0n;
        let glTotal = 0n;
        const rows = result.rows.map((r) => {
          const stock = value.parseSigned(r.stock_value);
          const gl = signedMoney(r.gl_balance);
          stockTotal += stock;
          glTotal += gl;
          return { accountId: r.account_id, code: r.code, name: r.name, stockValue: value.format(stock), glBalance: value.format(gl), difference: value.format(gl - stock), reconciled: gl === stock };
        });
        return { companyId, asOf, rows, stockTotal: value.format(stockTotal), glTotal: value.format(glTotal), difference: value.format(glTotal - stockTotal), reconciled: rows.every((r) => r.reconciled) };
      },
      { readOnly: true, isolation: 'repeatable read' },
    );
  }
}

const signedMoney = (text: string): bigint => (text.startsWith('-') ? -moneyToUnits(text.slice(1)) : moneyToUnits(text));
