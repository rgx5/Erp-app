import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { divRound, qty, value } from '../inventory/decimal.js';
import { StockService, type MoveLine } from '../inventory/stock.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { parties } from '../masterdata/masterdata.schema.js';
import { businessLocations, warehouses } from '../organization/organization.schema.js';
import { nextDocNumber } from '../sales/doc-number.js';
import { subcontractChallanLines, subcontractChallans, subcontractOrders, workOrderMaterials, workOrders } from './manufacturing.schema.js';
import type { CreateSubcontractOrderInput, ReceiveJobWorkInput, SendChallanInput } from './manufacturing.schemas.js';
import { WorkOrdersService } from './work-orders.service.js';

export type SubcontractOrderRow = typeof subcontractOrders.$inferSelect;
/** Goods sent to a job worker must come back (or be accounted for) within a year (GST: inputs one year, capital goods three). */
const RETURN_DAYS = 365;
const addDays = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Subcontracting (job work). The order is a work order whose materials sit at the job worker's warehouse; the principal keeps owning
 * them, so a challan is a stock transfer with no ledger entry. At receipt the materials actually used go into WIP, the job-work
 * charge is capitalised from the clearing account (the job worker's invoice is booked there as an ordinary supplier bill) and the
 * finished goods come into stock at the pooled cost, all through the work-order machinery.
 */
@Injectable()
export class SubcontractingService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  create(tenantId: string, actorId: string, input: CreateSubcontractOrderInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [jw] = await tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, input.subcontractorId)));
      if (!jw || !jw.isSubcontractor || jw.status !== 'active') throw validationFailed([{ path: 'subcontractorId', message: 'This is not an active subcontractor' }]);
      const [wh] = await tx.select({ w: warehouses }).from(warehouses).innerJoin(businessLocations, and(eq(businessLocations.tenantId, warehouses.tenantId), eq(businessLocations.id, warehouses.businessLocationId))).where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, input.jobWorkerWarehouseId), eq(businessLocations.companyId, input.companyId)));
      if (!wh || wh.w.kind !== 'subcontractor' || wh.w.status !== 'active') throw validationFailed([{ path: 'jobWorkerWarehouseId', message: 'Must be an active warehouse of kind subcontractor' }]);
      if (input.sourceWarehouseId === input.jobWorkerWarehouseId) throw validationFailed([{ path: 'sourceWarehouseId', message: 'Must differ from the job worker warehouse' }]);
      const view = await this.orders.create(tenantId, actorId, { companyId: input.companyId, itemId: input.itemId, bomId: input.bomId, orderDate: input.orderDate, plannedQuantity: input.plannedQuantity, outputWarehouseId: input.outputWarehouseId, materialsWarehouseId: input.jobWorkerWarehouseId, plannedStart: input.plannedStart, dueDate: input.dueDate, notes: input.notes });
      const sco = first(await tx.insert(subcontractOrders).values({ tenantId, id: uuidv7(), companyId: input.companyId, workOrderId: view.workOrder.id, subcontractorId: input.subcontractorId, jobworkerWarehouseId: input.jobWorkerWarehouseId, sourceWarehouseId: input.sourceWarehouseId, ratePerUnit: input.ratePerUnit, createdBy: actorId }).returning(), 'Subcontract order');
      await this.recorder.record(tx, tenantId, 'subcontract_order', 'created', sco, { woNo: view.workOrder.woNo, subcontractorId: input.subcontractorId });
      return this.read(tx, tenantId, sco.id);
    });
  }

  release(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => { const o = await this.lock(tx, tenantId, id); if (o.status !== 'open') throw new AppError(409, 'order_closed', `This order is ${o.status}`); await this.orders.release(tenantId, o.workOrderId); return this.read(tx, tenantId, id); });
  }

  /** Cancels an order before anything was sent. */
  cancel(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const o = await this.lock(tx, tenantId, id);
      const [c] = await tx.select({ id: subcontractChallans.id }).from(subcontractChallans).where(and(eq(subcontractChallans.tenantId, tenantId), eq(subcontractChallans.orderId, id))).limit(1);
      if (c) throw new AppError(409, 'has_challans', 'Materials were already sent to the job worker');
      await this.orders.cancel(tenantId, o.workOrderId);
      await tx.update(subcontractOrders).set({ status: 'cancelled' }).where(and(eq(subcontractOrders.tenantId, tenantId), eq(subcontractOrders.id, id)));
      return this.read(tx, tenantId, id);
    });
  }

  /** Sends materials to the job worker on a delivery challan: a transfer between our own warehouses, no ledger entry. */
  send(tenantId: string, actorId: string, id: string, input: SendChallanInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const o = await this.lock(tx, tenantId, id);
      const wo = await this.liveOrder(tx, tenantId, o);
      const mats = await tx.select().from(workOrderMaterials).where(and(eq(workOrderMaterials.tenantId, tenantId), eq(workOrderMaterials.workOrderId, wo.id)));
      input.lines.forEach((l, i) => { if (!mats.some((m) => m.itemId === l.itemId)) throw validationFailed([{ path: `lines.${i}.itemId`, message: 'This item is not a material of the order' }]); });
      await this.moveChallan(tx, tenantId, actorId, o, 'send', input, o.sourceWarehouseId, o.jobworkerWarehouseId);
      if (!o.firstSentOn) await tx.update(subcontractOrders).set({ firstSentOn: input.date, returnDueDate: addDays(input.date, RETURN_DAYS) }).where(and(eq(subcontractOrders.tenantId, tenantId), eq(subcontractOrders.id, id)));
      return this.read(tx, tenantId, id);
    });
  }

  /** Brings unused materials back to the source warehouse. */
  returnMaterials(tenantId: string, actorId: string, id: string, input: SendChallanInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const o = await this.lock(tx, tenantId, id);
      if (o.status === 'cancelled') throw new AppError(409, 'order_cancelled', 'This order was cancelled');
      const pending = await this.pendingOf(tx, tenantId, o);
      const asked = new Map<string, bigint>();
      input.lines.forEach((l, i) => {
        const p = pending.get(l.itemId) ?? 0n;
        const total = (asked.get(l.itemId) ?? 0n) + qty.parse(l.quantity);
        asked.set(l.itemId, total);
        if (total > p) throw new AppError(409, 'return_exceeds_pending', `Only ${qty.format(p)} is still with the job worker`, { available: qty.format(p), line: i + 1 });
      });
      await this.moveChallan(tx, tenantId, actorId, o, 'return', input, o.jobworkerWarehouseId, o.sourceWarehouseId);
      return this.read(tx, tenantId, id);
    });
  }

  /** Receives finished goods: materials used go into WIP, the job-work charge is capitalised, the goods come into stock at the pooled cost. */
  receive(tenantId: string, actorId: string, id: string, input: ReceiveJobWorkInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const o = await this.lock(tx, tenantId, id);
      const wo = await this.liveOrder(tx, tenantId, o);
      const mats = await tx.select().from(workOrderMaterials).where(and(eq(workOrderMaterials.tenantId, tenantId), eq(workOrderMaterials.workOrderId, wo.id)));
      const q = qty.parse(input.quantity);
      const lines = input.consumption ?? mats.map((m) => ({ itemId: m.itemId, quantity: qty.format(divRound(qty.parse(m.requiredQuantity) * q, qty.parse(wo.plannedQuantity))) })).filter((l) => qty.parse(l.quantity) > 0n);
      const pending = await this.pendingOf(tx, tenantId, o);
      const used = new Map<string, bigint>();
      for (const [i, l] of lines.entries()) {
        const total = (used.get(l.itemId) ?? 0n) + qty.parse(l.quantity);
        used.set(l.itemId, total);
        if (total > (pending.get(l.itemId) ?? 0n)) throw new AppError(409, 'consumption_exceeds_pending', `The job worker holds only ${qty.format(pending.get(l.itemId) ?? 0n)} of this material: send more first`, { available: qty.format(pending.get(l.itemId) ?? 0n), line: i + 1 });
      }
      if (lines.length > 0) await this.orders.issueMaterials(tenantId, actorId, wo.id, { date: input.date, lines });
      const charge = input.chargeAmount ?? value.format(divRound(value.parse(o.ratePerUnit) * q, 10n ** 6n));
      await this.orders.bookSubcontractCharge(tx, tenantId, actorId, wo.id, input.date, charge);
      await this.orders.reportOutput(tenantId, actorId, wo.id, { date: input.date, quantity: input.quantity, scrapQuantity: input.scrapQuantity, batch: input.batch, batchId: input.batchId, serialNos: input.serialNos }, { takeWholePool: true }); // what was consumed and charged for this receipt is exactly what these goods cost
      await this.recorder.record(tx, tenantId, 'subcontract_order', 'received', o, { quantity: input.quantity, charge });
      return this.read(tx, tenantId, id);
    });
  }

  /** Closes the order: anything left in WIP goes to production variance; materials still at the job worker stay on the pending report. */
  complete(tenantId: string, actorId: string, id: string, date: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const o = await this.lock(tx, tenantId, id);
      await this.orders.complete(tenantId, actorId, o.workOrderId, date);
      await tx.update(subcontractOrders).set({ status: 'closed' }).where(and(eq(subcontractOrders.tenantId, tenantId), eq(subcontractOrders.id, id)));
      return this.read(tx, tenantId, id);
    });
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------------
  get(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.read(tx, tenantId, id), { readOnly: true }); }
  private async read(tx: Tx, tenantId: string, id: string) {
    const order = first(await tx.select().from(subcontractOrders).where(and(eq(subcontractOrders.tenantId, tenantId), eq(subcontractOrders.id, id))), 'Subcontract order');
    const challans = await tx.select().from(subcontractChallans).where(and(eq(subcontractChallans.tenantId, tenantId), eq(subcontractChallans.orderId, id))).orderBy(asc(subcontractChallans.challanDate), asc(subcontractChallans.id));
    const lines = challans.length > 0 ? await tx.select().from(subcontractChallanLines).where(and(eq(subcontractChallanLines.tenantId, tenantId), inArray(subcontractChallanLines.challanId, challans.map((c) => c.id)))).orderBy(asc(subcontractChallanLines.lineNo)) : [];
    const mine = lines;
    const pending = await this.pendingOf(tx, tenantId, order);
    return { order, workOrder: await this.orders.get(tenantId, order.workOrderId), challans: challans.map((c) => ({ ...c, lines: mine.filter((l) => l.challanId === c.id) })), pending: [...pending].map(([itemId, q]) => ({ itemId, quantity: qty.format(q) })) };
  }
  list(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; subcontractorId?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(subcontractOrders).where(and(eq(subcontractOrders.tenantId, tenantId), eq(subcontractOrders.companyId, q.companyId), before ? lt(subcontractOrders.id, before) : undefined, q.subcontractorId ? eq(subcontractOrders.subcontractorId, q.subcontractorId) : undefined, q.status ? eq(subcontractOrders.status, q.status) : undefined)).orderBy(desc(subcontractOrders.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  /** Materials still with job workers, with how long they have been out; over a year is flagged (GST treats it as a supply). */
  pendingReport(tenantId: string, companyId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const open = await tx.select().from(subcontractOrders).where(and(eq(subcontractOrders.tenantId, tenantId), eq(subcontractOrders.companyId, companyId), eq(subcontractOrders.status, 'open'))).orderBy(asc(subcontractOrders.id));
      const rows = [];
      for (const o of open) {
        const pending = [...(await this.pendingOf(tx, tenantId, o))].filter(([, q]) => q > 0n);
        if (pending.length === 0 || !o.firstSentOn) continue;
        const [wo] = await tx.select({ woNo: workOrders.woNo }).from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, o.workOrderId)));
        const days = daysBetween(o.firstSentOn, asOf);
        rows.push({ orderId: o.id, woNo: wo?.woNo ?? '', subcontractorId: o.subcontractorId, firstSentOn: o.firstSentOn, returnDueDate: o.returnDueDate, daysOut: days, overdue: days > RETURN_DAYS, items: pending.map(([itemId, q]) => ({ itemId, quantity: qty.format(q) })) });
      }
      return { asOf, orders: rows, overdueCount: rows.filter((r) => r.overdue).length };
    }, { readOnly: true });
  }

  // ---- helpers ---------------------------------------------------------------------------------------------------------------
  private async lock(tx: Tx, tenantId: string, id: string): Promise<SubcontractOrderRow> {
    return first(await tx.select().from(subcontractOrders).where(and(eq(subcontractOrders.tenantId, tenantId), eq(subcontractOrders.id, id))).for('update'), 'Subcontract order');
  }
  private async liveOrder(tx: Tx, tenantId: string, o: SubcontractOrderRow) {
    if (o.status !== 'open') throw new AppError(409, 'order_closed', `This order is ${o.status}`);
    const wo = first(await tx.select().from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, o.workOrderId))), 'Work order');
    if (wo.status !== 'released' && wo.status !== 'in_progress') throw new AppError(409, 'not_live', wo.status === 'planned' ? 'Release the order first' : `This order is ${wo.status}`);
    return wo;
  }
  /** Sent less returned less consumed, per material: what the job worker still holds for this order. */
  private async pendingOf(tx: Tx, tenantId: string, o: SubcontractOrderRow): Promise<Map<string, bigint>> {
    const res = await tx.execute<{ item_id: string; sent: string; back: string }>(sql`
      SELECT l.item_id, COALESCE(SUM(l.quantity) FILTER (WHERE c.kind = 'send'), 0)::text AS sent, COALESCE(SUM(l.quantity) FILTER (WHERE c.kind = 'return'), 0)::text AS back
        FROM erp.subcontract_challan_lines l JOIN erp.subcontract_challans c ON c.tenant_id = l.tenant_id AND c.id = l.challan_id
       WHERE c.tenant_id = ${tenantId}::uuid AND c.order_id = ${o.id}::uuid GROUP BY l.item_id`);
    const mats = await tx.select().from(workOrderMaterials).where(and(eq(workOrderMaterials.tenantId, tenantId), eq(workOrderMaterials.workOrderId, o.workOrderId)));
    const out = new Map<string, bigint>();
    for (const r of res.rows) {
      const used = qty.parse(mats.find((m) => m.itemId === r.item_id)?.issuedQuantity ?? '0');
      out.set(r.item_id, qty.parse(r.sent) - qty.parse(r.back) - used);
    }
    return out;
  }
  private async moveChallan(tx: Tx, tenantId: string, actorId: string, o: SubcontractOrderRow, kind: 'send' | 'return', input: SendChallanInput, from: string, to: string): Promise<void> {
    const challanId = uuidv7();
    const challanNo = await nextDocNumber(tx, tenantId, o.companyId, input.date, 'DC');
    const moveLines: MoveLine[] = input.lines.flatMap((l, i) => [
      { warehouseId: from, itemId: l.itemId, direction: 'out' as const, quantity: l.quantity, batchId: l.batchId, serialNos: l.serialNos },
      { warehouseId: to, itemId: l.itemId, direction: 'in' as const, quantity: l.quantity, batchId: l.batchId, serialNos: l.serialNos, carryFrom: i * 2 },
    ]);
    const { movement } = await this.stock.move(tx, tenantId, { companyId: o.companyId, movementType: 'transfer_direct', postingDate: input.date, description: `${challanNo}: ${kind === 'send' ? 'materials to' : 'materials back from'} job worker`, lines: moveLines, source: { type: 'subcontract_challan', id: challanId, event: kind }, postedBy: actorId });
    await tx.insert(subcontractChallans).values({ tenantId, id: challanId, companyId: o.companyId, orderId: o.id, challanNo, kind, challanDate: input.date, vehicleNo: input.vehicleNo ?? null, ewayBillNo: input.ewayBillNo ?? null, stockMovementId: movement.id, createdBy: actorId });
    await tx.insert(subcontractChallanLines).values(input.lines.map((l, i) => ({ tenantId, id: uuidv7(), challanId, lineNo: i + 1, itemId: l.itemId, quantity: l.quantity, batchId: l.batchId ?? null, serialNos: l.serialNos ?? null })));
    await this.recorder.record(tx, tenantId, 'subcontract_challan', kind === 'send' ? 'sent' : 'returned', { id: challanId }, { challanNo, orderId: o.id, lines: input.lines.length });
  }
}
