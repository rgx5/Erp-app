import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, notFound, validationFailed } from '../../platform/http/errors.js';
import { first, pageOf, Recorder } from '../masterdata/helpers.js';
import { items } from '../masterdata/masterdata.schema.js';
import { businessLocations, warehouses } from '../organization/organization.schema.js';
import { qty } from './decimal.js';
import { batchBalances, stockBalances, stockReservations } from './inventory.schema.js';
import { StockService } from './stock.service.js';

export type ReservationRow = typeof stockReservations.$inferSelect;

/**
 * Reservations hold stock for an order without moving it. Held quantity is not available to other issues; an issue that names the
 * reservation consumes it. Creation locks the same balance row as movements do, so a reservation and an issue can never both
 * claim the last unit.
 */
@Injectable()
export class ReservationsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  create(tenantId: string, actorId: string, input: { companyId: string; warehouseId: string; itemId: string; batchId?: string | undefined; quantity: string; referenceType: string; referenceId: string; expiresAt?: string | undefined }): Promise<ReservationRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const item = first(await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, input.itemId))), 'Item');
      if (!item.isStocked) throw new AppError(422, 'item_not_stocked', `${item.code} is not a stocked item`);
      const [w] = await tx
        .select({ status: warehouses.status, kind: warehouses.kind, companyId: businessLocations.companyId })
        .from(warehouses)
        .innerJoin(businessLocations, and(eq(businessLocations.tenantId, warehouses.tenantId), eq(businessLocations.id, warehouses.businessLocationId)))
        .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, input.warehouseId)));
      if (!w || w.companyId !== input.companyId) throw validationFailed([{ path: 'warehouseId', message: 'This warehouse does not exist in this company' }]);
      if (w.status !== 'active' || w.kind === 'in_transit') throw new AppError(422, 'warehouse_not_reservable', 'Stock can only be reserved in an active, non-transit warehouse');
      if (item.tracking === 'serial') throw new AppError(422, 'serial_reservation', 'Serial-tracked items cannot be reserved yet; issue them by serial number');
      if (input.batchId && item.tracking !== 'batch') throw new AppError(422, 'item_not_batch_tracked', `${item.code} is not batch tracked`);
      const q = qty.parse(input.quantity);

      // The same lock movements take: reserving and issuing the last unit cannot both succeed.
      await tx.insert(stockBalances).values({ tenantId, companyId: input.companyId, warehouseId: input.warehouseId, itemId: input.itemId }).onConflictDoNothing();
      const [balance] = await tx.select().from(stockBalances).where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.warehouseId, input.warehouseId), eq(stockBalances.itemId, input.itemId))).for('update');
      const available = qty.parseSigned(balance?.quantity ?? '0') - (await this.stock.reservedQuantity(tx, tenantId, input.warehouseId, input.itemId));
      if (available < q) {
        const shown = qty.format(available > 0n ? available : 0n);
        throw new AppError(409, 'insufficient_stock', `Only ${shown} of ${item.code} is available to reserve`, { available: shown, requested: input.quantity });
      }
      if (input.batchId) {
        const [bb] = await tx.select().from(batchBalances).where(and(eq(batchBalances.tenantId, tenantId), eq(batchBalances.warehouseId, input.warehouseId), eq(batchBalances.itemId, input.itemId), eq(batchBalances.batchId, input.batchId)));
        const batchAvailable = qty.parse(bb?.quantity ?? '0') - (await this.stock.reservedQuantity(tx, tenantId, input.warehouseId, input.itemId, input.batchId));
        if (batchAvailable < q) throw new AppError(409, 'insufficient_batch_stock', `Only ${qty.format(batchAvailable > 0n ? batchAvailable : 0n)} of that batch is available to reserve`);
      }
      const row = first(
        await tx
          .insert(stockReservations)
          .values({ tenantId, id: uuidv7(), companyId: input.companyId, warehouseId: input.warehouseId, itemId: input.itemId, batchId: input.batchId ?? null, quantity: input.quantity, referenceType: input.referenceType, referenceId: input.referenceId, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, createdBy: actorId })
          .returning(),
        'Reservation',
      );
      return this.recorder.record(tx, tenantId, 'stock_reservation', 'created', row, { itemId: input.itemId, warehouseId: input.warehouseId, quantity: input.quantity, referenceType: input.referenceType, referenceId: input.referenceId });
    });
  }

  /** Gives back whatever has not been consumed. */
  release(tenantId: string, id: string): Promise<ReservationRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(stockReservations).where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.id, id))).for('update');
      if (!row) throw notFound('Reservation');
      if (row.status !== 'active') throw new AppError(409, 'reservation_not_active', `This reservation is already ${row.status}`);
      const updated = first(await tx.update(stockReservations).set({ status: 'released', releasedAt: new Date(), updatedAt: new Date() }).where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.id, id))).returning(), 'Reservation');
      return this.recorder.record(tx, tenantId, 'stock_reservation', 'released', updated, { outstanding: qty.format(qty.parse(updated.quantity) - qty.parse(updated.consumedQuantity)) });
    });
  }

  get(tenantId: string, id: string): Promise<ReservationRow> {
    return this.uow.inTenant(tenantId, async (tx) => first(await tx.select().from(stockReservations).where(and(eq(stockReservations.tenantId, tenantId), eq(stockReservations.id, id))), 'Reservation'), { readOnly: true });
  }

  list(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; itemId?: string | undefined; warehouseId?: string | undefined; status?: string | undefined; referenceType?: string | undefined; referenceId?: string | undefined }) {
    return this.uow.inTenant(
      tenantId,
      (tx) =>
        pageOf<ReservationRow>(tx, stockReservations, tenantId, q.limit, q.cursor, eq(stockReservations.companyId, q.companyId), q.itemId ? eq(stockReservations.itemId, q.itemId) : undefined, q.warehouseId ? eq(stockReservations.warehouseId, q.warehouseId) : undefined,
          q.status ? eq(stockReservations.status, q.status) : undefined, q.referenceType ? eq(stockReservations.referenceType, q.referenceType) : undefined, q.referenceId ? eq(stockReservations.referenceId, q.referenceId) : undefined),
      { readOnly: true },
    );
  }

  /** On hand, reserved and available per warehouse for an item. */
  availability(tenantId: string, companyId: string, itemId: string, warehouseId?: string) {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const rows = await tx.select().from(stockBalances).where(and(eq(stockBalances.tenantId, tenantId), eq(stockBalances.companyId, companyId), eq(stockBalances.itemId, itemId), warehouseId ? eq(stockBalances.warehouseId, warehouseId) : undefined));
        const out = [];
        for (const b of rows) {
          const reserved = await this.stock.reservedQuantity(tx, tenantId, b.warehouseId, itemId);
          const onHand = qty.parseSigned(b.quantity);
          out.push({ warehouseId: b.warehouseId, onHand: b.quantity, reserved: qty.format(reserved), available: qty.format(onHand - reserved > 0n ? onHand - reserved : 0n) });
        }
        return { itemId, warehouses: out };
      },
      { readOnly: true },
    );
  }
}
