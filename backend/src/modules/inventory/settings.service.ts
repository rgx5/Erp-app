import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, notFound, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, type Page, toPage } from '../../platform/http/validation.js';
import { accounts } from '../accounting/accounting.schema.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { items } from '../masterdata/masterdata.schema.js';
import { businessLocations, warehouses } from '../organization/organization.schema.js';
import type { CreateBatchInput } from './inventory.schemas.js';
import { batches, companyStockSettings, inventoryAccounts } from './inventory.schema.js';

export type StockSettingsRow = typeof companyStockSettings.$inferSelect;
export type InventoryAccountRow = typeof inventoryAccounts.$inferSelect;
export type BatchRow = typeof batches.$inferSelect;

/** Where stock lands in the general ledger, per-warehouse stock rules, and batch records. */
@Injectable()
export class InventorySettingsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  getSettings(tenantId: string, companyId: string): Promise<StockSettingsRow | null> {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.select().from(companyStockSettings).where(and(eq(companyStockSettings.tenantId, tenantId), eq(companyStockSettings.companyId, companyId))))[0] ?? null, { readOnly: true });
  }

  /** The offset accounts for opening stock and adjustments. They must be ordinary postable accounts (not groups, not control accounts). */
  putSettings(tenantId: string, companyId: string, input: { adjustmentAccountId?: string | null; openingBalanceAccountId?: string | null }): Promise<StockSettingsRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      for (const [field, id] of Object.entries(input)) {
        if (!id) continue;
        const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, id)));
        if (!a) throw validationFailed([{ path: field, message: 'This account does not exist in this company' }]);
        if (a.isGroup || a.status !== 'active' || a.controlKind) throw validationFailed([{ path: field, message: 'Must be an active, postable, non-control account' }]);
      }
      const [existing] = await tx.select().from(companyStockSettings).where(and(eq(companyStockSettings.tenantId, tenantId), eq(companyStockSettings.companyId, companyId))).for('update');
      const row = existing
        ? first(await tx.update(companyStockSettings).set(input).where(and(eq(companyStockSettings.tenantId, tenantId), eq(companyStockSettings.companyId, companyId))).returning(), 'Stock settings')
        : first(await tx.insert(companyStockSettings).values({ tenantId, companyId, ...input }).returning(), 'Stock settings');
      await this.recorder.record(tx, tenantId, 'stock_settings', 'updated', { id: companyId }, { companyId, ...input });
      return row;
    });
  }

  listInventoryAccounts(tenantId: string, companyId: string): Promise<InventoryAccountRow[]> {
    return this.uow.inTenant(tenantId, (tx) => tx.select().from(inventoryAccounts).where(and(eq(inventoryAccounts.tenantId, tenantId), eq(inventoryAccounts.companyId, companyId))).orderBy(asc(inventoryAccounts.itemType)), { readOnly: true });
  }

  /** Sets (or changes) the GL account that holds stock of an item type. The database requires an inventory/WIP control account. */
  mapInventoryAccount(tenantId: string, companyId: string, itemType: string, accountId: string): Promise<InventoryAccountRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const row = first(
        await tx
          .insert(inventoryAccounts)
          .values({ tenantId, id: uuidv7(), companyId, itemType, accountId })
          .onConflictDoUpdate({ target: [inventoryAccounts.tenantId, inventoryAccounts.companyId, inventoryAccounts.itemType], set: { accountId } })
          .returning(),
        'Inventory account',
      );
      return this.recorder.record(tx, tenantId, 'inventory_account', 'mapped', row, { companyId, itemType, accountId });
    });
  }

  /** Whether this warehouse may go below zero (weighted-average items only; FIFO items are always blocked). */
  setWarehouseNegativeStock(tenantId: string, warehouseId: string, allow: boolean) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [w] = await tx.select().from(warehouses).where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, warehouseId))).for('update');
      if (!w) throw notFound('Warehouse');
      const [row] = await tx.update(warehouses).set({ allowNegativeStock: allow }).where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, warehouseId))).returning();
      await this.recorder.record(tx, tenantId, 'warehouse', 'stock_settings_changed', { id: warehouseId }, { allowNegativeStock: allow });
      const [location] = await tx.select({ companyId: businessLocations.companyId }).from(businessLocations).where(and(eq(businessLocations.tenantId, tenantId), eq(businessLocations.id, w.businessLocationId)));
      return { id: warehouseId, code: row?.code, allowNegativeStock: row?.allowNegativeStock, companyId: location?.companyId };
    });
  }

  // ---- batches -----------------------------------------------------------------------------------------------------
  createBatch(tenantId: string, itemId: string, input: CreateBatchInput): Promise<BatchRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const item = first(await tx.select().from(items).where(and(eq(items.tenantId, tenantId), eq(items.id, itemId))), 'Item');
      if (item.tracking !== 'batch') throw new AppError(422, 'item_not_batch_tracked', 'This item is not batch tracked');
      const row = first(await tx.insert(batches).values({ tenantId, id: uuidv7(), itemId, ...input }).returning(), 'Batch');
      return this.recorder.record(tx, tenantId, 'batch', 'created', row, { itemId, batchNo: input.batchNo });
    });
  }
  listBatches(tenantId: string, itemId: string, limit: number, cursor?: string): Promise<Page<BatchRow>> {
    const after = decodeCursor(cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => toPage(await tx.select().from(batches).where(and(eq(batches.tenantId, tenantId), eq(batches.itemId, itemId), after ? gt(batches.id, after) : undefined)).orderBy(asc(batches.id)).limit(limit + 1), limit),
      { readOnly: true },
    );
  }
  setBatchStatus(tenantId: string, batchId: string, status: 'active' | 'blocked'): Promise<BatchRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const row = first(await tx.update(batches).set({ status }).where(and(eq(batches.tenantId, tenantId), eq(batches.id, batchId))).returning(), 'Batch');
      return this.recorder.record(tx, tenantId, 'batch', status === 'blocked' ? 'blocked' : 'unblocked', row, { batchNo: row.batchNo });
    });
  }
}
