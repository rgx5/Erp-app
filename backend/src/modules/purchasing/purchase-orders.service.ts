import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { cost, divRound, qty, valueOf } from '../inventory/decimal.js';
import { StockService, type MoveLine } from '../inventory/stock.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { items, parties, taxCodes } from '../masterdata/masterdata.schema.js';
import { gstRegistrations, warehouses, businessLocations } from '../organization/organization.schema.js';
import { nextDocNumber } from '../sales/doc-number.js';
import { goodsReceiptLines, goodsReceipts, purchaseOrderLines, purchaseOrders } from './purchasing.schema.js';
import type { CreateGoodsReceiptInput, CreatePurchaseOrderInput } from './purchasing.schemas.js';
import { PurchasingSettingsService } from './purchasing-settings.service.js';

export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type PurchaseOrderLineRow = typeof purchaseOrderLines.$inferSelect;
export type GoodsReceiptRow = typeof goodsReceipts.$inferSelect;
export type GoodsReceiptLineRow = typeof goodsReceiptLines.$inferSelect;

/** Net unit price after discount, as a stock cost (6 decimal places): price x (1 - discount%), rounded half up. */
export function netUnitCost(unitPrice: string, discountPercent: string): string {
  const [pi = '0', pf = ''] = unitPrice.split('.');
  const priceUnits = BigInt(pi) * 10_000n + BigInt(pf.padEnd(4, '0').slice(0, 4)); // 1e-4
  const [di = '0', df = ''] = discountPercent.split('.');
  const discountUnits = BigInt(di) * 10_000n + BigInt(df.padEnd(4, '0').slice(0, 4)); // percent, 1e-4 (100% = 1_000_000)
  const net = divRound(priceUnits * 100n * (1_000_000n - discountUnits), 1_000_000n); // 1e-6
  return cost.format(net);
}

/** Purchase orders and goods receipts. A receipt brings stock in at the order's net price and accrues Dr inventory / Cr GRNI. */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(PurchasingSettingsService) private readonly settings: PurchasingSettingsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- purchase orders ------------------------------------------------------------------------------------------------
  createOrder(tenantId: string, actorId: string, input: CreatePurchaseOrderInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.requireSupplier(tx, tenantId, input.supplierId);
      const [registration] = await tx.select().from(gstRegistrations).where(and(eq(gstRegistrations.tenantId, tenantId), eq(gstRegistrations.companyId, input.companyId), eq(gstRegistrations.id, input.gstRegistrationId)));
      if (!registration || registration.status !== 'active') throw validationFailed([{ path: 'gstRegistrationId', message: 'This GST registration does not exist for the company or is not active' }]);
      if (input.businessLocationId) {
        const [loc] = await tx.select({ id: businessLocations.id }).from(businessLocations).where(and(eq(businessLocations.tenantId, tenantId), eq(businessLocations.companyId, input.companyId), eq(businessLocations.id, input.businessLocationId)));
        if (!loc) throw validationFailed([{ path: 'businessLocationId', message: 'This location does not belong to the company' }]);
      }
      const itemRows = new Map((await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, [...new Set(input.lines.map((l) => l.itemId))])))).map((i) => [i.id, i]));
      const warehouseIds = [...new Set(input.lines.flatMap((l) => (l.warehouseId ? [l.warehouseId] : [])))];
      const wh = warehouseIds.length > 0 ? await tx.select({ id: warehouses.id }).from(warehouses).innerJoin(businessLocations, and(eq(businessLocations.tenantId, warehouses.tenantId), eq(businessLocations.id, warehouses.businessLocationId))).where(and(eq(warehouses.tenantId, tenantId), eq(businessLocations.companyId, input.companyId), inArray(warehouses.id, warehouseIds))) : [];
      const taxIds = [...new Set(input.lines.flatMap((l) => (l.taxCodeId ? [l.taxCodeId] : [])))];
      const taxRows = taxIds.length > 0 ? await tx.select({ id: taxCodes.id }).from(taxCodes).where(and(eq(taxCodes.tenantId, tenantId), inArray(taxCodes.id, taxIds))) : [];
      input.lines.forEach((l, i) => {
        const item = itemRows.get(l.itemId);
        if (!item || item.status !== 'active') throw validationFailed([{ path: `lines.${i}.itemId`, message: 'This item does not exist or is not active' }]);
        if (l.warehouseId && !wh.some((w) => w.id === l.warehouseId)) throw validationFailed([{ path: `lines.${i}.warehouseId`, message: 'This warehouse does not belong to the company' }]);
        if (l.taxCodeId && !taxRows.some((t) => t.id === l.taxCodeId)) throw validationFailed([{ path: `lines.${i}.taxCodeId`, message: 'This tax code does not exist' }]);
      });
      const poNo = await nextDocNumber(tx, tenantId, input.companyId, input.orderDate, 'PO');
      const order = first(
        await tx
          .insert(purchaseOrders)
          .values({ tenantId, id: uuidv7(), companyId: input.companyId, poNo, gstRegistrationId: input.gstRegistrationId, businessLocationId: input.businessLocationId ?? null, supplierId: input.supplierId, orderDate: input.orderDate, expectedDate: input.expectedDate ?? null, supplierReference: input.supplierReference ?? null, notes: input.notes ?? null, createdBy: actorId })
          .returning(),
        'Purchase order',
      );
      const lines = await tx
        .insert(purchaseOrderLines)
        .values(input.lines.map((l, i) => ({ tenantId, id: uuidv7(), orderId: order.id, lineNo: i + 1, itemId: l.itemId, description: l.description ?? itemRows.get(l.itemId)?.name ?? '', quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxCodeId: l.taxCodeId ?? itemRows.get(l.itemId)?.taxCodeId ?? null, warehouseId: l.warehouseId ?? null })))
        .returning();
      await this.recorder.record(tx, tenantId, 'purchase_order', 'created', order, { poNo, supplierId: input.supplierId, lines: lines.length });
      return { order, lines };
    });
  }

  /** Cancels an order nothing was received or billed against. */
  cancelOrder(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const order = await this.lockLive(tx, tenantId, id);
      const lines = await this.linesOf(tx, tenantId, id);
      if (lines.some((l) => qty.parse(l.quantityReceived) > 0n || qty.parse(l.quantityBilled) > 0n)) throw new AppError(409, 'has_receipts', 'Goods were received or billed against this order; close it instead');
      return this.finish(tx, tenantId, order, 'cancelled');
    });
  }

  /** Stops an order from being received or billed further. */
  closeOrder(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => this.finish(tx, tenantId, await this.lockLive(tx, tenantId, id), 'closed'));
  }

  private async lockLive(tx: Tx, tenantId: string, id: string): Promise<PurchaseOrderRow> {
    const order = first(await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id))).for('update'), 'Purchase order');
    if (order.status === 'closed' || order.status === 'cancelled') throw new AppError(409, 'order_finished', `This order is already ${order.status}`);
    return order;
  }

  private async finish(tx: Tx, tenantId: string, order: PurchaseOrderRow, status: 'closed' | 'cancelled') {
    const updated = first(await tx.update(purchaseOrders).set({ status, closedAt: new Date() }).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, order.id))).returning(), 'Purchase order');
    await this.recorder.record(tx, tenantId, 'purchase_order', status, updated, { poNo: updated.poNo });
    return this.readOrder(tx, tenantId, order.id);
  }

  /** Re-derives open / partially_received / received from the stocked lines (services are billed, never received). */
  async refreshStatus(tx: Tx, tenantId: string, orderId: string): Promise<void> {
    const [order] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, orderId)));
    if (!order || order.status === 'closed' || order.status === 'cancelled') return;
    const rows = await tx.select({ l: purchaseOrderLines, stocked: items.isStocked }).from(purchaseOrderLines).innerJoin(items, and(eq(items.tenantId, purchaseOrderLines.tenantId), eq(items.id, purchaseOrderLines.itemId))).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.orderId, orderId)));
    const stocked = rows.filter((r) => r.stocked);
    const any = stocked.some((r) => qty.parse(r.l.quantityReceived) > 0n);
    const all = stocked.length > 0 && stocked.every((r) => qty.parse(r.l.quantityReceived) === qty.parse(r.l.quantity));
    const status = all ? 'received' : any ? 'partially_received' : 'open';
    if (status !== order.status) await tx.update(purchaseOrders).set({ status }).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, orderId)));
  }

  // ---- goods receipts -------------------------------------------------------------------------------------------------
  /**
   * Receives goods: stock in at the order's net price (or the stated price for an unordered receipt), GRNI accrued, the receipt
   * document numbered and recorded, the order's received quantities advanced, all in one transaction.
   */
  receive(tenantId: string, actorId: string, input: CreateGoodsReceiptInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      let order: PurchaseOrderRow | null = null;
      let orderLines = new Map<string, PurchaseOrderLineRow>();
      if (input.purchaseOrderId) {
        order = first(await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, input.purchaseOrderId))).for('update'), 'Purchase order');
        if (order.companyId !== input.companyId) throw validationFailed([{ path: 'purchaseOrderId', message: 'This order belongs to another company' }]);
        if (order.status === 'closed' || order.status === 'cancelled') throw new AppError(409, 'order_finished', `This order is ${order.status}`);
        orderLines = new Map((await this.linesOf(tx, tenantId, order.id)).map((l) => [l.id, l]));
        if (input.supplierId && input.supplierId !== order.supplierId) throw validationFailed([{ path: 'supplierId', message: 'The supplier differs from the order' }]);
      }
      const supplierId = order?.supplierId ?? input.supplierId;
      if (!supplierId) throw validationFailed([{ path: 'supplierId', message: 'Name the supplier (or receive against an order)' }]);
      await this.requireSupplier(tx, tenantId, supplierId);
      const settings = await this.settings.require(tx, tenantId, input.companyId, ['grniAccountId']);

      const itemIds = [...new Set(input.lines.flatMap((l) => (l.orderLineId ? [orderLines.get(l.orderLineId)?.itemId ?? ''] : l.itemId ? [l.itemId] : [])))].filter(Boolean);
      const itemRows = new Map((await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)))).map((i) => [i.id, i]));
      const taken = new Map<string, bigint>(); // quantity this receipt takes from each order line
      const prepared = input.lines.map((l, i) => {
        const at = (f: string) => `lines.${i}.${f}`;
        const ol = l.orderLineId ? orderLines.get(l.orderLineId) : undefined;
        if (l.orderLineId && !ol) throw validationFailed([{ path: at('orderLineId'), message: 'This line is not on the order' }]);
        if (!order && l.orderLineId) throw validationFailed([{ path: at('orderLineId'), message: 'Name the purchase order to receive against its lines' }]);
        const itemId = ol?.itemId ?? l.itemId;
        const item = itemId ? itemRows.get(itemId) : undefined;
        if (!item) throw validationFailed([{ path: at('itemId'), message: 'Name the item (or an order line)' }]);
        if (!item.isStocked) throw new AppError(422, 'item_not_stocked', `${item.code} is not a stocked item; it is billed, not received`);
        if (ol && l.itemId && l.itemId !== ol.itemId) throw validationFailed([{ path: at('itemId'), message: 'The item differs from the order line' }]);
        const warehouseId = l.warehouseId ?? ol?.warehouseId;
        if (!warehouseId) throw validationFailed([{ path: at('warehouseId'), message: 'Say which warehouse receives this line' }]);
        let unitCost: string;
        if (ol) {
          unitCost = netUnitCost(ol.unitPrice, ol.discountPercent);
          if (l.unitPrice !== undefined) throw validationFailed([{ path: at('unitPrice'), message: 'Lines against an order are valued at the order price' }]);
          const total = (taken.get(ol.id) ?? 0n) + qty.parse(l.quantity);
          taken.set(ol.id, total);
          const remaining = qty.parse(ol.quantity) - qty.parse(ol.quantityReceived);
          if (total > remaining) throw new AppError(409, 'receipt_exceeds_order', `Only ${qty.format(remaining)} of ${item.code} (line ${ol.lineNo}) remains to be received`, { remaining: qty.format(remaining), lineNo: ol.lineNo });
        } else {
          if (l.unitPrice === undefined) throw validationFailed([{ path: at('unitPrice'), message: 'A receipt with no order line needs the unit price' }]);
          unitCost = netUnitCost(l.unitPrice, '0');
        }
        return { l, ol, item, warehouseId, unitCost };
      });

      const grnNo = await nextDocNumber(tx, tenantId, input.companyId, input.receiptDate, 'GRN');
      const moveLines: MoveLine[] = prepared.map((p) => ({ warehouseId: p.warehouseId, itemId: p.item.id, direction: 'in' as const, quantity: p.l.quantity, unitCost: p.unitCost, batchId: p.l.batchId, batch: p.l.batch, serialNos: p.l.serialNos }));
      const receiptId = uuidv7();
      const { movement, results } = await this.stock.move(tx, tenantId, {
        companyId: input.companyId, movementType: 'receipt', postingDate: input.receiptDate, description: `Goods receipt ${grnNo}`, lines: moveLines,
        offsetAccountId: settings.grniAccountId as string, allowControlOffset: true, source: { type: 'goods_receipt', id: receiptId, event: 'receive' }, postedBy: actorId,
      });
      const receipt = first(
        await tx
          .insert(goodsReceipts)
          .values({ tenantId, id: receiptId, companyId: input.companyId, grnNo, purchaseOrderId: order?.id ?? null, supplierId, receiptDate: input.receiptDate, supplierDeliveryNote: input.supplierDeliveryNote ?? null, notes: input.notes ?? null, stockMovementId: movement.id, receivedBy: actorId })
          .returning(),
        'Goods receipt',
      );
      const lines = await tx
        .insert(goodsReceiptLines)
        .values(prepared.map((p, i) => ({ tenantId, id: uuidv7(), receiptId, lineNo: i + 1, orderLineId: p.ol?.id ?? null, itemId: p.item.id, warehouseId: p.warehouseId, quantity: p.l.quantity, unitCost: p.unitCost, value: results[i]?.ledger.value ?? qtyValue(p.l.quantity, p.unitCost), batchId: results[i]?.batchId ?? null, serialNos: results[i]?.serialNos.length ? results[i]?.serialNos : null })))
        .returning();
      for (const [lineId, total] of taken) {
        const ol = orderLines.get(lineId) as PurchaseOrderLineRow;
        await tx.update(purchaseOrderLines).set({ quantityReceived: qty.format(qty.parse(ol.quantityReceived) + total) }).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.id, lineId)));
      }
      if (order) await this.refreshStatus(tx, tenantId, order.id);
      await this.recorder.record(tx, tenantId, 'goods_receipt', 'posted', receipt, { grnNo, supplierId, purchaseOrderId: order?.id ?? null, lines: lines.length });
      return { receipt, lines };
    });
  }

  /** Goods received and not yet invoiced, by supplier, valued as booked; compared with the GRNI account balance. */
  async grniReport(tenantId: string, companyId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          supplierId: goodsReceipts.supplierId, grnNo: goodsReceipts.grnNo, receiptDate: goodsReceipts.receiptDate, receiptId: goodsReceipts.id, lineId: goodsReceiptLines.id, itemId: goodsReceiptLines.itemId,
          quantity: goodsReceiptLines.quantity, billed: goodsReceiptLines.quantityBilled, returned: goodsReceiptLines.quantityReturned, unitCost: goodsReceiptLines.unitCost,
        })
        .from(goodsReceiptLines)
        .innerJoin(goodsReceipts, and(eq(goodsReceipts.tenantId, goodsReceiptLines.tenantId), eq(goodsReceipts.id, goodsReceiptLines.receiptId)))
        .where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.companyId, companyId), sql`${goodsReceipts.receiptDate} <= ${asOf}::date`))
        .orderBy(asc(goodsReceipts.receiptDate), asc(goodsReceiptLines.id));
      const lines = rows
        .map((r) => {
          const open = qty.parse(r.quantity) - qty.parse(r.billed) - qty.parse(r.returned);
          return { ...r, openQuantity: qty.format(open), openValue: valueFmt(valueOf(open, cost.parse(r.unitCost))) };
        })
        .filter((r) => qty.parse(r.openQuantity) > 0n);
      const total = lines.reduce((a, l) => a + BigInt(l.openValue.replace('.', '')), 0n);
      return { asOf, lines, totalOpenValue: `${total / 10_000n}.${(total % 10_000n).toString().padStart(4, '0')}` };
    }, { readOnly: true });
  }

  // ---- reads ------------------------------------------------------------------------------------------------------------
  getOrder(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.readOrder(tx, tenantId, id), { readOnly: true }); }
  getReceipt(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => ({ receipt: first(await tx.select().from(goodsReceipts).where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.id, id))), 'Goods receipt'), lines: await tx.select().from(goodsReceiptLines).where(and(eq(goodsReceiptLines.tenantId, tenantId), eq(goodsReceiptLines.receiptId, id))).orderBy(asc(goodsReceiptLines.lineNo)) }), { readOnly: true });
  }
  private async readOrder(tx: Tx, tenantId: string, id: string) {
    const order = first(await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, id))), 'Purchase order');
    const receipts = await tx.select({ id: goodsReceipts.id, grnNo: goodsReceipts.grnNo, receiptDate: goodsReceipts.receiptDate }).from(goodsReceipts).where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.purchaseOrderId, id))).orderBy(asc(goodsReceipts.id));
    return { order, lines: await this.linesOf(tx, tenantId, id), receipts };
  }
  private linesOf(tx: Tx, tenantId: string, orderId: string) {
    return tx.select().from(purchaseOrderLines).where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.orderId, orderId))).orderBy(asc(purchaseOrderLines.lineNo));
  }

  listOrders(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; supplierId?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.companyId, q.companyId), before ? lt(purchaseOrders.id, before) : undefined, q.supplierId ? eq(purchaseOrders.supplierId, q.supplierId) : undefined, q.status ? eq(purchaseOrders.status, q.status) : undefined)).orderBy(desc(purchaseOrders.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }
  listReceipts(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; supplierId?: string | undefined; purchaseOrderId?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(goodsReceipts).where(and(eq(goodsReceipts.tenantId, tenantId), eq(goodsReceipts.companyId, q.companyId), before ? lt(goodsReceipts.id, before) : undefined, q.supplierId ? eq(goodsReceipts.supplierId, q.supplierId) : undefined, q.purchaseOrderId ? eq(goodsReceipts.purchaseOrderId, q.purchaseOrderId) : undefined)).orderBy(desc(goodsReceipts.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  private async requireSupplier(tx: Tx, tenantId: string, supplierId: string): Promise<void> {
    const [s] = await tx.select({ isSupplier: parties.isSupplier, status: parties.status }).from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, supplierId)));
    if (!s || !s.isSupplier || s.status !== 'active') throw validationFailed([{ path: 'supplierId', message: 'This is not an active supplier' }]);
  }
}

const valueFmt = (units: bigint): string => `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`;
const qtyValue = (quantity: string, unitCost: string): string => valueFmt(valueOf(qty.parse(quantity), cost.parse(unitCost)));
