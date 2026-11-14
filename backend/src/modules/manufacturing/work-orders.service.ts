import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { PostingService, type PostingLine } from '../accounting/posting.service.js';
import { divRound, qty, value } from '../inventory/decimal.js';
import { StockService } from '../inventory/stock.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { businessLocations, warehouses } from '../organization/organization.schema.js';
import { nextDocNumber } from '../sales/doc-number.js';
import { bomLines, bomOperations, boms, workCentres, workOrderMaterials, workOrderOperations, workOrderTransactions, workOrders } from './manufacturing.schema.js';
import type { CreateWorkOrderInput, IssueMaterialsInput, ReportOutputInput, ReportTimeInput } from './manufacturing.schemas.js';
import { ManufacturingSettingsService } from './manufacturing-settings.service.js';
import { ManufacturingMastersService, requirement } from './masters.service.js';

export type WorkOrderRow = typeof workOrders.$inferSelect;
export type WorkOrderMaterialRow = typeof workOrderMaterials.$inferSelect;
export type WorkOrderOperationRow = typeof workOrderOperations.$inferSelect;
export type WorkOrderTxnRow = typeof workOrderTransactions.$inferSelect;

const LIVE = ['released', 'in_progress'];
const money = (units: bigint): string => value.format(units);

/**
 * Work orders and work in progress. Each order snapshots its BOM. Materials issued to it leave stock at actual cost into WIP, labour
 * and overhead are absorbed into WIP at the work centre's rates, finished goods come into stock at the cost pooled in the order, and
 * completing it clears any residual to production variance. All of it is in the caller's transaction: stock ledger, journals and the
 * order's own immutable transaction rows commit together.
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(ManufacturingMastersService) private readonly masters: ManufacturingMastersService,
    @Inject(ManufacturingSettingsService) private readonly settings: ManufacturingSettingsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- creating and releasing ----------------------------------------------------------------------------------------
  create(tenantId: string, actorId: string, input: CreateWorkOrderInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const bom = input.bomId
        ? first(await tx.select().from(boms).where(and(eq(boms.tenantId, tenantId), eq(boms.companyId, input.companyId), eq(boms.id, input.bomId))), 'BOM')
        : await this.masters.activeBom(tx, tenantId, input.companyId, input.itemId, input.orderDate);
      if (!bom) throw new AppError(422, 'no_active_bom', 'No BOM is in force for this item on the order date');
      if (bom.itemId !== input.itemId) throw validationFailed([{ path: 'bomId', message: 'This BOM is for a different item' }]);
      if (bom.status !== 'active' || bom.effectiveFrom > input.orderDate || (bom.effectiveTo && bom.effectiveTo < input.orderDate)) throw new AppError(422, 'bom_not_in_force', 'This BOM is obsolete or not in force on the order date');
      for (const [path, id] of [['outputWarehouseId', input.outputWarehouseId], ['materialsWarehouseId', input.materialsWarehouseId]] as const) {
        const [w] = await tx.select({ id: warehouses.id }).from(warehouses).innerJoin(businessLocations, and(eq(businessLocations.tenantId, warehouses.tenantId), eq(businessLocations.id, warehouses.businessLocationId))).where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, id), eq(businessLocations.companyId, input.companyId), eq(warehouses.status, 'active')));
        if (!w) throw validationFailed([{ path, message: 'An active warehouse of this company is needed' }]);
      }
      if (input.dueDate && input.plannedStart && input.dueDate < input.plannedStart) throw validationFailed([{ path: 'dueDate', message: 'Must not be before the planned start' }]);
      const lines = await tx.select().from(bomLines).where(and(eq(bomLines.tenantId, tenantId), eq(bomLines.bomId, bom.id))).orderBy(asc(bomLines.lineNo));
      const ops = await tx.select().from(bomOperations).where(and(eq(bomOperations.tenantId, tenantId), eq(bomOperations.bomId, bom.id))).orderBy(asc(bomOperations.opNo));
      const planned = qty.parse(input.plannedQuantity);
      const base = qty.parse(bom.baseQuantity);
      const woNo = await nextDocNumber(tx, tenantId, input.companyId, input.orderDate, 'WO');
      const wo = first(await tx.insert(workOrders).values({ tenantId, id: uuidv7(), companyId: input.companyId, woNo, itemId: input.itemId, bomId: bom.id, plannedQuantity: input.plannedQuantity, outputWarehouseId: input.outputWarehouseId, materialsWarehouseId: input.materialsWarehouseId, plannedStart: input.plannedStart ?? null, dueDate: input.dueDate ?? null, notes: input.notes ?? null, createdBy: actorId }).returning(), 'Work order');
      await tx.insert(workOrderMaterials).values(lines.map((l, i) => ({ tenantId, id: uuidv7(), workOrderId: wo.id, lineNo: i + 1, itemId: l.itemId, requiredQuantity: qty.format(requirement(l.quantity, l.scrapPercent, planned, base)) }))).returning();
      if (ops.length > 0) await tx.insert(workOrderOperations).values(ops.map((o) => ({ tenantId, id: uuidv7(), workOrderId: wo.id, opNo: o.opNo, name: o.name, workCentreId: o.workCentreId, plannedHours: fmtHours(parseHours(o.setupHours) + divRound(parseHours(o.runHours) * planned, base)) })));
      await this.recorder.record(tx, tenantId, 'work_order', 'created', wo, { woNo, itemId: input.itemId, plannedQuantity: input.plannedQuantity });
      return this.read(tx, tenantId, wo.id);
    });
  }

  release(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const wo = await this.lock(tx, tenantId, id);
      if (wo.status !== 'planned') throw new AppError(409, 'not_planned', `This work order is ${wo.status}`);
      const updated = first(await tx.update(workOrders).set({ status: 'released', releasedAt: new Date() }).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id))).returning(), 'Work order');
      await this.recorder.record(tx, tenantId, 'work_order', 'released', updated, { woNo: updated.woNo });
      return this.read(tx, tenantId, id);
    });
  }

  /** Cancels an order nothing has happened to. */
  cancel(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const wo = await this.lock(tx, tenantId, id);
      if (wo.status !== 'planned' && wo.status !== 'released') throw new AppError(409, 'not_cancellable', `This work order is ${wo.status}`);
      const [t] = await tx.select({ id: workOrderTransactions.id }).from(workOrderTransactions).where(and(eq(workOrderTransactions.tenantId, tenantId), eq(workOrderTransactions.workOrderId, id))).limit(1);
      if (t) throw new AppError(409, 'has_transactions', 'Materials, time or output were already booked to this work order');
      const updated = first(await tx.update(workOrders).set({ status: 'cancelled', cancelledAt: new Date() }).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id))).returning(), 'Work order');
      await this.recorder.record(tx, tenantId, 'work_order', 'cancelled', updated, { woNo: updated.woNo });
      return this.read(tx, tenantId, id);
    });
  }

  // ---- materials ------------------------------------------------------------------------------------------------------
  /** Takes materials out of stock into the order's WIP at their actual cost. */
  issueMaterials(tenantId: string, actorId: string, id: string, input: IssueMaterialsInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const wo = await this.live(tx, tenantId, id);
      const acc = await this.settings.require(tx, tenantId, wo.companyId, ['wipAccountId']);
      const mats = await this.materialsOf(tx, tenantId, id);
      const prepared = input.lines.map((l, i) => {
        const m = mats.find((x) => x.itemId === l.itemId);
        if (!m) throw validationFailed([{ path: `lines.${i}.itemId`, message: 'This item is not a material of the work order' }]);
        return { l, m, warehouseId: l.warehouseId ?? wo.materialsWarehouseId };
      });
      const { movement, results } = await this.stock.move(tx, tenantId, {
        companyId: wo.companyId, movementType: 'issue', postingDate: input.date, description: `Materials for ${wo.woNo}`,
        lines: prepared.map((p) => ({ warehouseId: p.warehouseId, itemId: p.m.itemId, direction: 'out' as const, quantity: p.l.quantity, batchId: p.l.batchId, serialNos: p.l.serialNos })),
        offsetAccountId: acc.wipAccountId as string, allowControlOffset: true, source: { type: 'work_order', id: `${id}:${uuidv7()}`, event: 'issue' }, postedBy: actorId,
      });
      const rows = [];
      const added = new Map<string, bigint>();
      for (const [n, p] of prepared.entries()) {
        const v = -value.parseSigned(results[n]?.ledger.value ?? '0');
        rows.push({ tenantId, id: uuidv7(), workOrderId: id, companyId: wo.companyId, kind: 'material_issue', txnDate: input.date, itemId: p.m.itemId, quantity: p.l.quantity, value: money(v), stockMovementId: movement.id, journalEntryIds: movement.journalEntryId ? [movement.journalEntryId] : [], createdBy: actorId });
        added.set(p.m.id, (added.get(p.m.id) ?? 0n) + qty.parse(p.l.quantity));
      }
      for (const [mid, q] of added) {
        const m = mats.find((x) => x.id === mid) as WorkOrderMaterialRow;
        await tx.update(workOrderMaterials).set({ issuedQuantity: qty.format(qty.parse(m.issuedQuantity) + q) }).where(and(eq(workOrderMaterials.tenantId, tenantId), eq(workOrderMaterials.id, mid)));
      }
      await tx.insert(workOrderTransactions).values(rows);
      await this.started(tx, tenantId, wo);
      await this.recorder.record(tx, tenantId, 'work_order', 'materials_issued', wo, { woNo: wo.woNo, lines: rows.length });
      return this.read(tx, tenantId, id);
    });
  }

  /** Puts unused materials back into stock at the average cost they went out at. */
  returnMaterials(tenantId: string, actorId: string, id: string, input: IssueMaterialsInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const wo = await this.live(tx, tenantId, id);
      const acc = await this.settings.require(tx, tenantId, wo.companyId, ['wipAccountId']);
      const mats = await this.materialsOf(tx, tenantId, id);
      // What is still in the order for each material: quantity and cost. Returns leave at that average cost.
      const state = new Map<string, { qty: bigint; value: bigint }>();
      for (const m of mats) {
        const [agg] = await tx.select({ v: sql<string>`COALESCE(SUM(${workOrderTransactions.value}), 0)::text` }).from(workOrderTransactions).where(and(eq(workOrderTransactions.tenantId, tenantId), eq(workOrderTransactions.workOrderId, id), eq(workOrderTransactions.itemId, m.itemId), inArray(workOrderTransactions.kind, ['material_issue', 'material_return'])));
        state.set(m.id, { qty: qty.parse(m.issuedQuantity) - qty.parse(m.returnedQuantity), value: value.parseSigned(agg?.v ?? '0') });
      }
      const prepared: { l: (typeof input.lines)[number]; m: WorkOrderMaterialRow; v: bigint; warehouseId: string }[] = [];
      const taken = new Map<string, bigint>();
      for (const [i, l] of input.lines.entries()) {
        const m = mats.find((x) => x.itemId === l.itemId);
        if (!m) throw validationFailed([{ path: `lines.${i}.itemId`, message: 'This item is not a material of the work order' }]);
        const st = state.get(m.id) as { qty: bigint; value: bigint };
        const q = qty.parse(l.quantity);
        if (q > st.qty) throw new AppError(409, 'return_exceeds_issued', `Only ${qty.format(st.qty)} of this material is still on the order`, { available: qty.format(st.qty) });
        const v = q === st.qty ? st.value : divRound(st.value * q, st.qty);
        st.qty -= q;
        st.value -= v;
        taken.set(m.id, (taken.get(m.id) ?? 0n) + q);
        prepared.push({ l, m, v, warehouseId: l.warehouseId ?? wo.materialsWarehouseId });
      }
      const { movement } = await this.stock.move(tx, tenantId, {
        companyId: wo.companyId, movementType: 'receipt', postingDate: input.date, description: `Materials returned from ${wo.woNo}`,
        lines: prepared.map((p) => ({ warehouseId: p.warehouseId, itemId: p.m.itemId, direction: 'in' as const, quantity: p.l.quantity, fixedValue: money(p.v), batchId: p.l.batchId, serialNos: p.l.serialNos, restore: p.l.serialNos !== undefined })),
        offsetAccountId: acc.wipAccountId as string, allowControlOffset: true, source: { type: 'work_order', id: `${id}:${uuidv7()}`, event: 'return' }, postedBy: actorId,
      });
      await tx.insert(workOrderTransactions).values(prepared.map((p) => ({ tenantId, id: uuidv7(), workOrderId: id, companyId: wo.companyId, kind: 'material_return', txnDate: input.date, itemId: p.m.itemId, quantity: p.l.quantity, value: money(-p.v), stockMovementId: movement.id, journalEntryIds: movement.journalEntryId ? [movement.journalEntryId] : [], createdBy: actorId })));
      for (const [mid, q] of taken) {
        const m = mats.find((x) => x.id === mid) as WorkOrderMaterialRow;
        await tx.update(workOrderMaterials).set({ returnedQuantity: qty.format(qty.parse(m.returnedQuantity) + q) }).where(and(eq(workOrderMaterials.tenantId, tenantId), eq(workOrderMaterials.id, mid)));
      }
      await this.recorder.record(tx, tenantId, 'work_order', 'materials_returned', wo, { woNo: wo.woNo, lines: prepared.length });
      return this.read(tx, tenantId, id);
    });
  }

  // ---- labour and overhead ---------------------------------------------------------------------------------------------
  /** Reports hours on operations: labour and overhead are absorbed into WIP at the work centre's current rates. */
  reportTime(tenantId: string, actorId: string, id: string, input: ReportTimeInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const wo = await this.live(tx, tenantId, id);
      const acc = await this.settings.require(tx, tenantId, wo.companyId, ['wipAccountId', 'labourAbsorbedAccountId', 'overheadAbsorbedAccountId']);
      const ops = await tx.select().from(workOrderOperations).where(and(eq(workOrderOperations.tenantId, tenantId), eq(workOrderOperations.workOrderId, id)));
      const rows = [];
      let labourTotal = 0n;
      let overheadTotal = 0n;
      const hoursBy = new Map<string, bigint>();
      for (const [i, l] of input.lines.entries()) {
        const op = ops.find((o) => o.opNo === l.opNo);
        if (!op) throw validationFailed([{ path: `lines.${i}.opNo`, message: 'This operation is not on the work order' }]);
        const [wc] = await tx.select().from(workCentres).where(and(eq(workCentres.tenantId, tenantId), eq(workCentres.id, op.workCentreId)));
        const h = parseHours(l.hours);
        const labour = divRound(h * parseMoney((wc as typeof workCentres.$inferSelect).labourRatePerHour), 10_000n);
        const overhead = divRound(h * (parseMoney((wc as typeof workCentres.$inferSelect).machineRatePerHour) + parseMoney((wc as typeof workCentres.$inferSelect).overheadRatePerHour)), 10_000n);
        labourTotal += labour;
        overheadTotal += overhead;
        hoursBy.set(op.id, (hoursBy.get(op.id) ?? 0n) + h);
        rows.push({ op, h, labour, overhead });
      }
      if (labourTotal + overheadTotal === 0n) throw new AppError(422, 'no_cost', 'These hours carry no cost: set rates on the work centres');
      const lines: PostingLine[] = [{ accountId: acc.wipAccountId as string, debit: money(labourTotal + overheadTotal), description: wo.woNo }];
      if (labourTotal > 0n) lines.push({ accountId: acc.labourAbsorbedAccountId as string, credit: money(labourTotal), description: wo.woNo });
      if (overheadTotal > 0n) lines.push({ accountId: acc.overheadAbsorbedAccountId as string, credit: money(overheadTotal), description: wo.woNo });
      const { entry } = await this.posting.post(tx, tenantId, { companyId: wo.companyId, postingDate: input.date, journalType: 'system', description: `Labour and overhead on ${wo.woNo}`, lines, source: { type: 'work_order', id: `${id}:${uuidv7()}`, event: 'conversion' }, postedBy: actorId });
      const txns = rows.flatMap((r) => [
        { tenantId, id: uuidv7(), workOrderId: id, companyId: wo.companyId, kind: 'labour', txnDate: input.date, operationId: r.op.id, hours: fmtHours(r.h), value: money(r.labour), journalEntryIds: [entry.id], createdBy: actorId },
        ...(r.overhead > 0n ? [{ tenantId, id: uuidv7(), workOrderId: id, companyId: wo.companyId, kind: 'overhead', txnDate: input.date, operationId: r.op.id, hours: fmtHours(r.h), value: money(r.overhead), journalEntryIds: [entry.id], createdBy: actorId }] : []),
      ]);
      await tx.insert(workOrderTransactions).values(txns);
      for (const [opId, h] of hoursBy) {
        const op = ops.find((o) => o.id === opId) as WorkOrderOperationRow;
        await tx.update(workOrderOperations).set({ actualHours: fmtHours(parseHours(op.actualHours) + h) }).where(and(eq(workOrderOperations.tenantId, tenantId), eq(workOrderOperations.id, opId)));
      }
      await this.started(tx, tenantId, wo);
      await this.recorder.record(tx, tenantId, 'work_order', 'time_reported', wo, { woNo: wo.woNo, labour: money(labourTotal), overhead: money(overheadTotal) });
      return this.read(tx, tenantId, id);
    });
  }

  // ---- finished goods ---------------------------------------------------------------------------------------------------
  /** Receives finished goods into stock at the cost pooled in the order (its whole WIP once the planned quantity is reached). */
  reportOutput(tenantId: string, actorId: string, id: string, input: ReportOutputInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const wo = await this.live(tx, tenantId, id);
      const acc = await this.settings.require(tx, tenantId, wo.companyId, ['wipAccountId']);
      const pool = await this.wip(tx, tenantId, id);
      if (pool <= 0n) throw new AppError(409, 'no_wip_cost', 'No cost has been put into this work order yet: issue materials or report time first');
      const q = qty.parse(input.quantity);
      const remaining = qty.parse(wo.plannedQuantity) - qty.parse(wo.producedQuantity);
      const v = q >= remaining ? pool : divRound(pool * q, remaining);
      const { movement } = await this.stock.move(tx, tenantId, {
        companyId: wo.companyId, movementType: 'receipt', postingDate: input.date, description: `Finished goods from ${wo.woNo}`,
        lines: [{ warehouseId: wo.outputWarehouseId, itemId: wo.itemId, direction: 'in', quantity: input.quantity, fixedValue: money(v), batchId: input.batchId, batch: input.batch, serialNos: input.serialNos }],
        offsetAccountId: acc.wipAccountId as string, allowControlOffset: true, source: { type: 'work_order', id: `${id}:${uuidv7()}`, event: 'output' }, postedBy: actorId,
      });
      await tx.insert(workOrderTransactions).values({ tenantId, id: uuidv7(), workOrderId: id, companyId: wo.companyId, kind: 'output', txnDate: input.date, itemId: wo.itemId, quantity: input.quantity, value: money(-v), stockMovementId: movement.id, journalEntryIds: movement.journalEntryId ? [movement.journalEntryId] : [], createdBy: actorId });
      await tx.update(workOrders).set({ producedQuantity: qty.format(qty.parse(wo.producedQuantity) + q), scrapQuantity: qty.format(qty.parse(wo.scrapQuantity) + qty.parse(input.scrapQuantity)) }).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id)));
      await this.started(tx, tenantId, wo);
      await this.recorder.record(tx, tenantId, 'work_order', 'output_reported', wo, { woNo: wo.woNo, quantity: input.quantity, value: money(v) });
      return this.read(tx, tenantId, id);
    });
  }

  /** Completes the order: any cost still in WIP (short output, over-consumption) is cleared to production variance. */
  complete(tenantId: string, actorId: string, id: string, date: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const wo = await this.lock(tx, tenantId, id);
      if (wo.status !== 'in_progress') throw new AppError(409, 'not_in_progress', wo.status === 'released' ? 'Nothing has been booked to this work order yet' : `This work order is ${wo.status}`);
      const pool = await this.wip(tx, tenantId, id);
      const ids: string[] = [];
      if (pool !== 0n) {
        const acc = await this.settings.require(tx, tenantId, wo.companyId, ['wipAccountId', 'productionVarianceAccountId']);
        const abs = money(pool < 0n ? -pool : pool);
        const lines: PostingLine[] = pool > 0n ? [{ accountId: acc.productionVarianceAccountId as string, debit: abs }, { accountId: acc.wipAccountId as string, credit: abs }] : [{ accountId: acc.wipAccountId as string, debit: abs }, { accountId: acc.productionVarianceAccountId as string, credit: abs }];
        const { entry } = await this.posting.post(tx, tenantId, { companyId: wo.companyId, postingDate: date, journalType: 'system', description: `Residual WIP cleared on completion of ${wo.woNo}`, lines, source: { type: 'work_order', id, event: 'residual' }, postedBy: actorId });
        ids.push(entry.id);
        await tx.insert(workOrderTransactions).values({ tenantId, id: uuidv7(), workOrderId: id, companyId: wo.companyId, kind: 'residual', txnDate: date, value: money(-pool), journalEntryIds: ids, note: 'Cleared to production variance', createdBy: actorId });
      }
      const updated = first(await tx.update(workOrders).set({ status: 'completed', completedAt: new Date() }).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id))).returning(), 'Work order');
      await this.recorder.record(tx, tenantId, 'work_order', 'completed', updated, { woNo: updated.woNo, residual: money(pool) });
      return this.read(tx, tenantId, id);
    });
  }

  // ---- reads ------------------------------------------------------------------------------------------------------------
  get(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.read(tx, tenantId, id), { readOnly: true }); }
  private async read(tx: Tx, tenantId: string, id: string) {
    const workOrder = first(await tx.select().from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id))), 'Work order');
    const transactions = await tx.select().from(workOrderTransactions).where(and(eq(workOrderTransactions.tenantId, tenantId), eq(workOrderTransactions.workOrderId, id))).orderBy(asc(workOrderTransactions.txnDate), asc(workOrderTransactions.id));
    const sum = (kinds: string[]) => transactions.filter((t) => kinds.includes(t.kind)).reduce((a, t) => a + value.parseSigned(t.value), 0n);
    return {
      workOrder, materials: await this.materialsOf(tx, tenantId, id), operations: await tx.select().from(workOrderOperations).where(and(eq(workOrderOperations.tenantId, tenantId), eq(workOrderOperations.workOrderId, id))).orderBy(asc(workOrderOperations.opNo)), transactions,
      cost: { materials: money(sum(['material_issue', 'material_return'])), labour: money(sum(['labour'])), overhead: money(sum(['overhead'])), finishedGoods: money(-sum(['output'])), residualCleared: money(-sum(['residual'])), wip: money(sum(['material_issue', 'material_return', 'labour', 'overhead', 'output', 'residual'])) },
    };
  }
  list(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; itemId?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.companyId, q.companyId), before ? lt(workOrders.id, before) : undefined, q.itemId ? eq(workOrders.itemId, q.itemId) : undefined, q.status ? eq(workOrders.status, q.status) : undefined)).orderBy(desc(workOrders.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  /** Proves the work orders' WIP (the sum of their transactions) equals the WIP control account, as of a date. */
  wipReconciliation(tenantId: string, companyId: string, asOf: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const acc = await this.settings.require(tx, tenantId, companyId, ['wipAccountId']);
      const res = await tx.execute<{ id: string; wo_no: string; status: string; wip: string }>(sql`
        SELECT w.id, w.wo_no, w.status, COALESCE(SUM(t.value), 0)::text AS wip
          FROM erp.work_orders w JOIN erp.work_order_transactions t ON t.tenant_id = w.tenant_id AND t.work_order_id = w.id AND t.txn_date <= ${asOf}::date
         WHERE w.tenant_id = ${tenantId}::uuid AND w.company_id = ${companyId}::uuid GROUP BY w.id, w.wo_no, w.status HAVING COALESCE(SUM(t.value), 0) <> 0 ORDER BY w.wo_no`);
      const [gl] = (await tx.execute<{ v: string }>(sql`SELECT COALESCE(SUM(debit - credit), 0)::text AS v FROM erp.journal_lines WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND account_id = ${acc.wipAccountId}::uuid AND posting_date <= ${asOf}::date`)).rows;
      const documents = res.rows.reduce((a, r) => a + value.parseSigned(r.wip), 0n);
      const ledger = value.parseSigned(gl?.v ?? '0');
      return { companyId, asOf, workOrders: res.rows.map((r) => ({ id: r.id, woNo: r.wo_no, status: r.status, wip: r.wip })), documents: money(documents), ledger: money(ledger), difference: money(ledger - documents), reconciled: documents === ledger };
    }, { readOnly: true, isolation: 'repeatable read' });
  }

  // ---- helpers -----------------------------------------------------------------------------------------------------------
  private async lock(tx: Tx, tenantId: string, id: string): Promise<WorkOrderRow> {
    return first(await tx.select().from(workOrders).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, id))).for('update'), 'Work order');
  }
  private async live(tx: Tx, tenantId: string, id: string): Promise<WorkOrderRow> {
    const wo = await this.lock(tx, tenantId, id);
    if (!LIVE.includes(wo.status)) throw new AppError(409, 'not_live', wo.status === 'planned' ? 'Release the work order first' : `This work order is ${wo.status}`);
    return wo;
  }
  private async started(tx: Tx, tenantId: string, wo: WorkOrderRow): Promise<void> {
    if (wo.status === 'released') await tx.update(workOrders).set({ status: 'in_progress' }).where(and(eq(workOrders.tenantId, tenantId), eq(workOrders.id, wo.id)));
  }
  private materialsOf(tx: Tx, tenantId: string, id: string) {
    return tx.select().from(workOrderMaterials).where(and(eq(workOrderMaterials.tenantId, tenantId), eq(workOrderMaterials.workOrderId, id))).orderBy(asc(workOrderMaterials.lineNo));
  }
  private async wip(tx: Tx, tenantId: string, id: string): Promise<bigint> {
    const [r] = await tx.select({ v: sql<string>`COALESCE(SUM(${workOrderTransactions.value}), 0)::text` }).from(workOrderTransactions).where(and(eq(workOrderTransactions.tenantId, tenantId), eq(workOrderTransactions.workOrderId, id)));
    return value.parseSigned(r?.v ?? '0');
  }
}

const parseHours = (text: string): bigint => { const [i = '0', f = ''] = text.split('.'); return BigInt(i) * 10_000n + BigInt(f.padEnd(4, '0').slice(0, 4)); };
const fmtHours = (units: bigint): string => `${units / 10_000n}.${(units % 10_000n).toString().padStart(4, '0')}`;
const parseMoney = parseHours; // both carry four decimal places
