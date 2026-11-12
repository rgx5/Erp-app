import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import type { Tx } from '../../platform/database/database.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { PeriodsService } from '../accounting/periods.service.js';
import { first, pageOf, Recorder } from '../masterdata/helpers.js';
import { businessLocations, warehouses } from '../organization/organization.schema.js';
import { qty } from './decimal.js';
import { stockCounters, stockTransferLines, stockTransfers } from './inventory.schema.js';
import { StockService, type MoveLine } from './stock.service.js';

export type TransferRow = typeof stockTransfers.$inferSelect;
export type TransferLineRow = typeof stockTransferLines.$inferSelect;

export interface CreateTransferInput {
  companyId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  transitWarehouseId?: string | undefined;
  postingDate: string;
  description: string;
  lines: { itemId: string; quantity: string; batchId?: string | undefined; serialNos?: string[] | undefined }[];
}

/**
 * Warehouse-to-warehouse transfers, direct or two-step through an in-transit warehouse. Stock moves at its own cost (no
 * revaluation) and, being inside one inventory account, produces no GL entry; the in-transit warehouse keeps it in the subledger and on
 * the balance sheet while it travels. Partial receipts leave the rest in transit. (For weighted-average items the in-transit cost
 * is pooled per item, so two simultaneous transfers of the same item blend their costs until received; total value is conserved.)
 */
@Injectable()
export class TransfersService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(PeriodsService) private readonly periods: PeriodsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  create(tenantId: string, actorId: string, input: CreateTransferInput): Promise<{ transfer: TransferRow; lines: TransferLineRow[] }> {
    return this.uow.inTenant(tenantId, async (tx) => {
      await this.assertWarehouses(tx, tenantId, input);
      const { fiscalYear } = await this.periods.openPeriodFor(tx, tenantId, input.companyId, input.postingDate);
      const transferNo = await this.nextNumber(tx, tenantId, input.companyId, fiscalYear.id, 'TF', fiscalYear.startDate, fiscalYear.endDate);
      const transit = input.transitWarehouseId;
      const transfer = first(
        await tx
          .insert(stockTransfers)
          .values({ tenantId, id: uuidv7(), companyId: input.companyId, transferNo, fromWarehouseId: input.fromWarehouseId, toWarehouseId: input.toWarehouseId, transitWarehouseId: transit ?? null, status: transit ? 'in_transit' : 'completed', postingDate: input.postingDate, description: input.description, createdBy: actorId })
          .returning(),
        'Transfer',
      );
      const lines = await tx
        .insert(stockTransferLines)
        .values(input.lines.map((l, i) => ({ tenantId, id: uuidv7(), transferId: transfer.id, lineNo: i + 1, itemId: l.itemId, batchId: l.batchId ?? null, quantity: l.quantity, receivedQuantity: transit ? '0' : l.quantity, serialNos: l.serialNos ?? null, receivedSerialNos: transit ? [] : (l.serialNos ?? []) })))
        .returning();
      const moveLines: MoveLine[] = input.lines.flatMap((l, i) => [
        { warehouseId: input.fromWarehouseId, itemId: l.itemId, direction: 'out' as const, quantity: l.quantity, batchId: l.batchId, serialNos: l.serialNos },
        { warehouseId: transit ?? input.toWarehouseId, itemId: l.itemId, direction: 'in' as const, quantity: l.quantity, batchId: l.batchId, serialNos: l.serialNos, carryFrom: i * 2 },
      ]);
      await this.stock.move(tx, tenantId, {
        companyId: input.companyId, movementType: transit ? 'transfer_dispatch' : 'transfer_direct', postingDate: input.postingDate, description: `${transferNo}: ${input.description}`,
        lines: moveLines, source: { type: 'stock_transfer', id: transfer.id, event: transit ? 'dispatch' : 'direct' }, postedBy: actorId,
      });
      await this.recorder.record(tx, tenantId, 'stock_transfer', transit ? 'dispatched' : 'completed', transfer, { transferNo, from: input.fromWarehouseId, to: input.toWarehouseId, lines: lines.length });
      return { transfer, lines };
    });
  }

  /** Receives dispatched stock into the destination: everything outstanding, or the lines (and quantities) given. */
  receive(tenantId: string, actorId: string, id: string, input: { postingDate: string; lines?: { lineId: string; quantity: string; serialNos?: string[] | undefined }[] | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const transfer = await this.lockInTransit(tx, tenantId, id);
      const lines = await tx.select().from(stockTransferLines).where(and(eq(stockTransferLines.tenantId, tenantId), eq(stockTransferLines.transferId, id))).orderBy(asc(stockTransferLines.lineNo));
      const wanted = input.lines ?? lines.filter((l) => qty.parse(l.quantity) > qty.parse(l.receivedQuantity)).map((l) => ({ lineId: l.id, quantity: qty.format(qty.parse(l.quantity) - qty.parse(l.receivedQuantity)), serialNos: l.serialNos ? outstandingSerials(l) : undefined }));
      if (wanted.length === 0) throw new AppError(409, 'nothing_to_receive', 'Everything on this transfer has been received');
      const moveLines: MoveLine[] = [];
      const updates: { line: TransferLineRow; received: bigint; serials: string[] }[] = [];
      wanted.forEach((w, i) => {
        const line = lines.find((l) => l.id === w.lineId);
        if (!line) throw validationFailed([{ path: `lines.${i}.lineId`, message: 'This line does not belong to the transfer' }]);
        const outstanding = qty.parse(line.quantity) - qty.parse(line.receivedQuantity);
        const q = qty.parse(w.quantity);
        if (q > outstanding) throw new AppError(409, 'receive_exceeds_dispatch', `Only ${qty.format(outstanding)} remains to be received on line ${line.lineNo}`, { outstanding: qty.format(outstanding) });
        const serials = w.serialNos ?? (line.serialNos ? [] : undefined);
        if (line.serialNos) {
          const open = new Set(outstandingSerials(line));
          if (!w.serialNos || BigInt(w.serialNos.length) * 10n ** 6n !== q || w.serialNos.some((s) => !open.has(s))) throw new AppError(422, 'serial_required', `Line ${line.lineNo}: give the serial numbers being received (from those still in transit)`);
        }
        updates.push({ line, received: q, serials: serials ?? [] });
        const idx = moveLines.length;
        moveLines.push({ warehouseId: transfer.transitWarehouseId as string, itemId: line.itemId, direction: 'out', quantity: w.quantity, batchId: line.batchId ?? undefined, serialNos: w.serialNos });
        moveLines.push({ warehouseId: transfer.toWarehouseId, itemId: line.itemId, direction: 'in', quantity: w.quantity, batchId: line.batchId ?? undefined, serialNos: w.serialNos, carryFrom: idx });
      });
      await this.stock.move(tx, tenantId, {
        companyId: transfer.companyId, movementType: 'transfer_receipt', postingDate: input.postingDate, description: `Receipt of ${transfer.transferNo}`, lines: moveLines,
        source: { type: 'stock_transfer', id, event: `receive:${uuidv7()}` }, postedBy: actorId,
      });
      for (const u of updates) {
        await tx.update(stockTransferLines).set({ receivedQuantity: qty.format(qty.parse(u.line.receivedQuantity) + u.received), receivedSerialNos: [...u.line.receivedSerialNos, ...u.serials] }).where(and(eq(stockTransferLines.tenantId, tenantId), eq(stockTransferLines.id, u.line.id)));
      }
      return this.refreshStatus(tx, tenantId, id, 'received');
    });
  }

  /** Brings undelivered stock back to the source. Only a transfer with nothing received can be cancelled. */
  cancel(tenantId: string, actorId: string, id: string, input: { postingDate: string; reason: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const transfer = await this.lockInTransit(tx, tenantId, id);
      const lines = await tx.select().from(stockTransferLines).where(and(eq(stockTransferLines.tenantId, tenantId), eq(stockTransferLines.transferId, id))).orderBy(asc(stockTransferLines.lineNo));
      if (lines.some((l) => qty.parse(l.receivedQuantity) > 0n)) throw new AppError(409, 'partially_received', 'Part of this transfer was already received; receive the rest instead');
      const moveLines: MoveLine[] = lines.flatMap((l, i) => [
        { warehouseId: transfer.transitWarehouseId as string, itemId: l.itemId, direction: 'out' as const, quantity: l.quantity, batchId: l.batchId ?? undefined, serialNos: l.serialNos ?? undefined },
        { warehouseId: transfer.fromWarehouseId, itemId: l.itemId, direction: 'in' as const, quantity: l.quantity, batchId: l.batchId ?? undefined, serialNos: l.serialNos ?? undefined, carryFrom: i * 2 },
      ]);
      await this.stock.move(tx, tenantId, { companyId: transfer.companyId, movementType: 'transfer_receipt', postingDate: input.postingDate, description: `Cancellation of ${transfer.transferNo}: ${input.reason}`, lines: moveLines, source: { type: 'stock_transfer', id, event: 'cancel' }, postedBy: actorId });
      const updated = first(await tx.update(stockTransfers).set({ status: 'cancelled' }).where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id))).returning(), 'Transfer');
      await this.recorder.record(tx, tenantId, 'stock_transfer', 'cancelled', updated, { transferNo: updated.transferNo, reason: input.reason });
      return { transfer: updated, lines };
    });
  }

  get(tenantId: string, id: string) {
    return this.uow.inTenant(
      tenantId,
      async (tx) => ({
        transfer: first(await tx.select().from(stockTransfers).where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id))), 'Transfer'),
        lines: await tx.select().from(stockTransferLines).where(and(eq(stockTransferLines.tenantId, tenantId), eq(stockTransferLines.transferId, id))).orderBy(asc(stockTransferLines.lineNo)),
      }),
      { readOnly: true },
    );
  }
  list(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; status?: string | undefined }) {
    return this.uow.inTenant(tenantId, (tx) => pageOf<TransferRow>(tx, stockTransfers, tenantId, q.limit, q.cursor, eq(stockTransfers.companyId, q.companyId), q.status ? eq(stockTransfers.status, q.status) : undefined), { readOnly: true });
  }

  // ---- internals ------------------------------------------------------------------------------------------------
  private async lockInTransit(tx: Tx, tenantId: string, id: string): Promise<TransferRow> {
    const transfer = first(await tx.select().from(stockTransfers).where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id))).for('update'), 'Transfer');
    if (transfer.status !== 'in_transit' && transfer.status !== 'partially_received') throw new AppError(409, 'transfer_not_in_transit', `This transfer is ${transfer.status}`);
    return transfer;
  }

  private async refreshStatus(tx: Tx, tenantId: string, id: string, _verb: string) {
    const lines = await tx.select().from(stockTransferLines).where(and(eq(stockTransferLines.tenantId, tenantId), eq(stockTransferLines.transferId, id))).orderBy(asc(stockTransferLines.lineNo));
    const done = lines.every((l) => qty.parse(l.receivedQuantity) === qty.parse(l.quantity));
    const transfer = first(await tx.update(stockTransfers).set({ status: done ? 'completed' : 'partially_received' }).where(and(eq(stockTransfers.tenantId, tenantId), eq(stockTransfers.id, id))).returning(), 'Transfer');
    await this.recorder.record(tx, tenantId, 'stock_transfer', done ? 'received' : 'partially_received', transfer, { transferNo: transfer.transferNo });
    return { transfer, lines };
  }

  private async assertWarehouses(tx: Tx, tenantId: string, input: CreateTransferInput): Promise<void> {
    const ids = [input.fromWarehouseId, input.toWarehouseId, ...(input.transitWarehouseId ? [input.transitWarehouseId] : [])];
    const found = await tx
      .select({ id: warehouses.id, kind: warehouses.kind, status: warehouses.status, companyId: businessLocations.companyId })
      .from(warehouses)
      .innerJoin(businessLocations, and(eq(businessLocations.tenantId, warehouses.tenantId), eq(businessLocations.id, warehouses.businessLocationId)))
      .where(and(eq(warehouses.tenantId, tenantId), inArray(warehouses.id, ids)));
    const byId = new Map(found.map((w) => [w.id, w]));
    for (const [field, id] of [['fromWarehouseId', input.fromWarehouseId], ['toWarehouseId', input.toWarehouseId], ['transitWarehouseId', input.transitWarehouseId]] as const) {
      if (!id) continue;
      const w = byId.get(id);
      if (!w || w.companyId !== input.companyId) throw validationFailed([{ path: field, message: 'This warehouse does not exist in this company' }]);
      if (w.status !== 'active') throw new AppError(422, 'warehouse_inactive', 'A warehouse in this transfer is inactive');
      if (field === 'transitWarehouseId' ? w.kind !== 'in_transit' : w.kind === 'in_transit') throw new AppError(422, 'warehouse_kind', field === 'transitWarehouseId' ? 'The transit warehouse must be of kind in_transit' : 'Source and destination cannot be in-transit warehouses');
    }
    if (input.fromWarehouseId === input.toWarehouseId) throw validationFailed([{ path: 'toWarehouseId', message: 'Source and destination must differ' }]);
  }

  private async nextNumber(tx: Tx, tenantId: string, companyId: string, fiscalYearId: string, prefix: string, start: string, end: string): Promise<string> {
    const [counter] = await tx
      .insert(stockCounters)
      .values({ tenantId, companyId, fiscalYearId, prefix, nextValue: 2 })
      .onConflictDoUpdate({ target: [stockCounters.tenantId, stockCounters.companyId, stockCounters.fiscalYearId, stockCounters.prefix], set: { nextValue: sqlIncrement() } })
      .returning({ next: stockCounters.nextValue });
    return `${prefix}/${start.slice(2, 4)}${end.slice(2, 4)}/${String((counter?.next ?? 2) - 1).padStart(6, '0')}`;
  }
}

const sqlIncrement = () => sql`${stockCounters.nextValue} + 1`;
const outstandingSerials = (l: TransferLineRow): string[] => (l.serialNos ?? []).filter((s) => !l.receivedSerialNos.includes(s));
