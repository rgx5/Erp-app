import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, notFound, validationFailed } from '../../platform/http/errors.js';
import { fiscalYears } from '../accounting/accounting.schema.js';
import { first, pageOf, Recorder } from '../masterdata/helpers.js';
import { items } from '../masterdata/masterdata.schema.js';
import { businessLocations, warehouses } from '../organization/organization.schema.js';
import { qty } from './decimal.js';
import { batchBalances, stockBalances, stockCountLines, stockCounters, stockCounts } from './inventory.schema.js';
import { StockService, type MoveLine } from './stock.service.js';

export type CountRow = typeof stockCounts.$inferSelect;
export type CountLineRow = typeof stockCountLines.$inferSelect;

/**
 * Physical stock counts. A count snapshots what the books say, people record what they found, and posting turns every difference
 * into one adjustment movement (gains at the line's cost or the item's valuation cost; losses at the valuation cost). The
 * difference is measured against the stock held AT POSTING (balances are locked first), so movements between the snapshot and the
 * posting are not double-counted. Serial-tracked items are not counted this way.
 */
@Injectable()
export class CountsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  create(tenantId: string, actorId: string, input: { companyId: string; warehouseId: string; countDate: string; description: string; itemIds?: string[] | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [w] = await tx
        .select({ status: warehouses.status, kind: warehouses.kind, companyId: businessLocations.companyId })
        .from(warehouses)
        .innerJoin(businessLocations, and(eq(businessLocations.tenantId, warehouses.tenantId), eq(businessLocations.id, warehouses.businessLocationId)))
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, input.warehouseId)));
      if (!w || w.companyId !== input.companyId) throw validationFailed([{ path: 'warehouseId', message: 'This warehouse does not exist in this company' }]);
      if (w.status !== 'active' || w.kind === 'in_transit') throw new AppError(422, 'warehouse_not_countable', 'Count an active, non-transit warehouse');

      const [year] = await tx.select().from(fiscalYears).where(and(eq(fiscalYears.tenantId, tenantId), eq(fiscalYears.companyId, input.companyId), sql`${fiscalYears.startDate} <= ${input.countDate}::date AND ${fiscalYears.endDate} >= ${input.countDate}::date`));
      if (!year) throw new AppError(409, 'no_accounting_period', `No fiscal year covers ${input.countDate}`);
      const [counter] = await tx
        .insert(stockCounters)
        .values({ tenantId, companyId: input.companyId, fiscalYearId: year.id, prefix: 'CN', nextValue: 2 })
        .onConflictDoUpdate({ target: [stockCounters.tenantId, stockCounters.companyId, stockCounters.fiscalYearId, stockCounters.prefix], set: { nextValue: sql`${stockCounters.nextValue} + 1` } })
        .returning({ next: stockCounters.nextValue });
      const countNo = `CN/${year.startDate.slice(2, 4)}${year.endDate.slice(2, 4)}/${String((counter?.next ?? 2) - 1).padStart(6, '0')}`;
      const count = first(await tx.insert(stockCounts).values({ tenantId, id: uuidv7(), companyId: input.companyId, countNo, warehouseId: input.warehouseId, countDate: input.countDate, description: input.description, createdBy: actorId }).returning(), 'Stock count');

      const wanted = await this.snapshot(tx, tenantId, input.warehouseId, input.itemIds);
      if (wanted.length > 0) {
        await tx.insert(stockCountLines).values(wanted.map((l) => ({ tenantId, id: uuidv7(), countId: count.id, itemId: l.itemId, batchId: l.batchId, snapshotQuantity: l.quantity })));
      }
      await this.recorder.record(tx, tenantId, 'stock_count', 'created', count, { countNo, warehouseId: input.warehouseId, lines: wanted.length });
      return this.read(tx, tenantId, count.id);
    });
  }

  /** Adds an item (or batch) to an open count, e.g. stock found that the books show as zero. */
  addLine(tenantId: string, countId: string, input: { itemId: string; batchId?: string | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const count = await this.lockOpen(tx, tenantId, countId);
      const [item] = await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, input.itemId)));
      if (!item || !item.isStocked) throw new AppError(422, 'item_not_stocked', 'Only stocked items can be counted');
      if (item.tracking === 'serial') throw new AppError(422, 'serial_count', 'Serial-tracked items are not counted this way');
      if (item.tracking === 'batch' && !input.batchId) throw new AppError(422, 'batch_required', `${item.code} is batch tracked: choose the batch`);
      if (item.tracking !== 'batch' && input.batchId) throw new AppError(422, 'item_not_batch_tracked', `${item.code} is not batch tracked`);
      const snapshot = await this.currentQuantity(tx, tenantId, count.warehouseId, input.itemId, input.batchId);
      const line = first(await tx.insert(stockCountLines).values({ tenantId, id: uuidv7(), countId, itemId: input.itemId, batchId: input.batchId ?? null, snapshotQuantity: qty.format(snapshot) }).returning(), 'Count line');
      return line;
    });
  }

  /** Records what was found. */
  record(tenantId: string, countId: string, lines: { lineId: string; countedQuantity: string; unitCost?: string | undefined }[]) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.lockOpen(tx, tenantId, countId);
      for (const l of lines) {
        const updated = await tx
          .update(stockCountLines)
          .set({ countedQuantity: l.countedQuantity, ...(l.unitCost !== undefined ? { unitCost: l.unitCost } : {}) })
          .where(and(eq(stockCountLines.tenantId, tenantId), eq(stockCountLines.countId, countId), eq(stockCountLines.id, l.lineId)))
          .returning({ id: stockCountLines.id });
        if (updated.length === 0) throw validationFailed([{ path: 'lines', message: `Line ${l.lineId} is not part of this count` }]);
      }
      return this.read(tx, tenantId, countId);
    });
  }

  post(tenantId: string, actorId: string, countId: string, input: { postingDate: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const count = await this.lockOpen(tx, tenantId, countId);
      const lines = await tx.select().from(stockCountLines).where(and(eq(stockCountLines.tenantId, tenantId), eq(stockCountLines.countId, countId))).orderBy(asc(stockCountLines.id));
      if (lines.length === 0) throw new AppError(422, 'empty_count', 'This count has no lines');
      const uncounted = lines.filter((l) => l.countedQuantity === null);
      if (uncounted.length > 0) throw new AppError(422, 'count_incomplete', `${uncounted.length} line(s) have no counted quantity yet`, { lineIds: uncounted.map((l) => l.id) });

      // Hold the balances while the differences are measured, so nothing moves underneath the count.
      const keys = [...new Set(lines.map((l) => l.itemId))].sort();
      for (const itemId of keys) {
        await tx.insert(stockBalances).values({ tenantId, companyId: count.companyId, warehouseId: count.warehouseId, itemId }).onConflictDoNothing();
        await tx.select({ q: stockBalances.quantity }).from(stockBalances).where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, count.warehouseId), eq(stockBalances.itemId, itemId))).for('update');
      }
      const moveLines: MoveLine[] = [];
      const measured: { id: string; system: bigint; variance: bigint }[] = [];
      for (const l of lines) {
        const system = await this.currentQuantity(tx, tenantId, count.warehouseId, l.itemId, l.batchId ?? undefined);
        const variance = qty.parse(l.countedQuantity as string) - system;
        measured.push({ id: l.id, system, variance });
        if (variance === 0n) continue;
        const abs = variance < 0n ? -variance : variance;
        moveLines.push({ warehouseId: count.warehouseId, itemId: l.itemId, direction: variance > 0n ? 'in' : 'out', quantity: qty.format(abs), batchId: l.batchId ?? undefined, ...(variance > 0n && l.unitCost !== null ? { unitCost: l.unitCost } : {}) });
      }
      let movementId: string | null = null;
      if (moveLines.length > 0) {
        const { movement } = await this.stock.move(tx, tenantId, { companyId: count.companyId, movementType: 'count_adjustment', postingDate: input.postingDate, description: `Stock count ${count.countNo}: ${count.description}`, lines: moveLines, source: { type: 'stock_count', id: countId }, postedBy: actorId });
        movementId = movement.id;
      }
      for (const m of measured) {
        await tx.update(stockCountLines).set({ systemQuantity: qty.format(m.system), variance: qty.format(m.variance) }).where(and(eq(stockCountLines.tenantId, tenantId), eq(stockCountLines.id, m.id)));
      }
      const posted = first(await tx.update(stockCounts).set({ status: 'posted', movementId }).where(and(eq(stockCounts.tenantId, tenantId), eq(stockCounts.id, countId))).returning(), 'Stock count');
      await this.recorder.record(tx, tenantId, 'stock_count', 'posted', posted, { countNo: posted.countNo, adjustedLines: moveLines.length, ...(movementId ? { movementId } : {}) });
      return this.read(tx, tenantId, countId);
    });
  }

  cancel(tenantId: string, countId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.lockOpen(tx, tenantId, countId);
      const cancelled = first(await tx.update(stockCounts).set({ status: 'cancelled' }).where(and(eq(stockCounts.tenantId, tenantId), eq(stockCounts.id, countId))).returning(), 'Stock count');
      await this.recorder.record(tx, tenantId, 'stock_count', 'cancelled', cancelled, { countNo: cancelled.countNo });
      return this.read(tx, tenantId, countId);
    });
  }

  get(tenantId: string, id: string) {
    return this.uow.inTenant(tenantId, (tx) => this.read(tx, tenantId, id), { readOnly: true });
  }
  list(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; status?: string | undefined }) {
    return this.uow.inTenant(tenantId, (tx) => pageOf<CountRow>(tx, stockCounts, tenantId, q.limit, q.cursor, eq(stockCounts.companyId, q.companyId), q.status ? eq(stockCounts.status, q.status) : undefined), { readOnly: true });
  }

  // ---- internals ------------------------------------------------------------------------------------------------
  private async read(tx: Tx, tenantId: string, id: string) {
    const count = first(await tx.select().from(stockCounts).where(and(eq(stockCounts.tenantId, tenantId), eq(stockCounts.id, id))), 'Stock count');
    const lines = await tx.select().from(stockCountLines).where(and(eq(stockCountLines.tenantId, tenantId), eq(stockCountLines.countId, id))).orderBy(asc(stockCountLines.id));
    return { count, lines };
  }

  private async lockOpen(tx: Tx, tenantId: string, id: string): Promise<CountRow> {
    const [count] = await tx.select().from(stockCounts).where(and(eq(stockCounts.tenantId, tenantId), eq(stockCounts.id, id))).for('update');
    if (!count) throw notFound('Stock count');
    if (count.status !== 'open') throw new AppError(409, 'count_not_open', `This count is ${count.status}`);
    return count;
  }

  private async currentQuantity(tx: Tx, tenantId: string, warehouseId: string, itemId: string, batchId?: string): Promise<bigint> {
    if (batchId) {
      const [b] = await tx.select().from(batchBalances).where(and(eq(batchBalances.tenantId, tenantId), eq(batchBalances.warehouseId, warehouseId), eq(batchBalances.itemId, itemId), eq(batchBalances.batchId, batchId)));
      return qty.parse(b?.quantity ?? '0');
    }
    const [b] = await tx.select().from(stockBalances).where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, warehouseId), eq(stockBalances.itemId, itemId)));
    return qty.parseSigned(b?.quantity ?? '0');
  }

  /** The lines a new count starts with: given items, or everything the warehouse holds. Batch items count per batch. */
  private async snapshot(tx: Tx, tenantId: string, warehouseId: string, itemIds: string[] | undefined): Promise<{ itemId: string; batchId: string | null; quantity: string }[]> {
    const out: { itemId: string; batchId: string | null; quantity: string }[] = [];
    const candidates = itemIds
      ? await tx.select().from(items).where(and(eq(items.tenantId, tenantId), inArray(items.id, itemIds)))
      : await tx.select({ i: items }).from(stockBalances).innerJoin(items, and(eq(items.tenantId, stockBalances.tenantId), eq(items.id, stockBalances.itemId))).where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, warehouseId), sql`${stockBalances.quantity} <> 0`)).then((r) => r.map((x) => x.i));
    if (itemIds && candidates.length !== new Set(itemIds).size) throw validationFailed([{ path: 'itemIds', message: 'An item does not exist' }]);
    for (const item of candidates) {
      if (!item.isStocked) throw new AppError(422, 'item_not_stocked', `${item.code} is not a stocked item`);
      if (item.tracking === 'serial') {
        if (itemIds) throw new AppError(422, 'serial_count', `${item.code} is serial tracked and is not counted this way`);
        continue;
      }
      if (item.tracking === 'batch') {
        const rows = await tx.select().from(batchBalances).where(and(eq(batchBalances.tenantId, tenantId), eq(batchBalances.warehouseId, warehouseId), eq(batchBalances.itemId, item.id), sql`${batchBalances.quantity} > 0`));
        for (const r of rows) out.push({ itemId: item.id, batchId: r.batchId, quantity: r.quantity });
      } else {
        out.push({ itemId: item.id, batchId: null, quantity: qty.format(await this.currentQuantity(tx, tenantId, warehouseId, item.id)) });
      }
    }
    return out.filter((l) => !(l.quantity.startsWith('-')));
  }
}
