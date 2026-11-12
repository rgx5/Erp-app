import { Body, Controller, Get, HttpCode, Inject, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import * as s from './inventory.schemas.js';
import { CountsService } from './counts.service.js';
import { StockOperationsController } from './operations.controller.js';
import { ReservationsService } from './reservations.service.js';
import { TransfersService } from './transfers.service.js';
import { InventorySettingsService } from './settings.service.js';
import { StockQueriesService } from './stock-queries.service.js';
import { StockService } from './stock.service.js';

const id = z.uuid();
const out = <T extends { tenantId: string }>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row;
  return rest;
};
const hide = <T extends object>(row: T): Omit<T, 'tenantId' | 'txId'> => {
  const { tenantId: _t, txId: _x, ...rest } = row as T & { tenantId?: string; txId?: number };
  return rest as Omit<T, 'tenantId' | 'txId'>;
};

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('v1')
export class InventoryController {
  constructor(
    @Inject(InventorySettingsService) private readonly settings: InventorySettingsService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(StockQueriesService) private readonly queries: StockQueriesService,
  ) {}

  // ---- configuration ------------------------------------------------------------------------------------------
  @RequirePermissions('stock:read') @Get('companies/:companyId/stock-settings')
  async getSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string) { const r = await this.settings.getSettings(t, c); return r ? out(r) : { companyId: c, adjustmentAccountId: null, openingBalanceAccountId: null }; }
  @RequirePermissions('stock:manage') @Put('companies/:companyId/stock-settings') @ApiZodBody(s.stockSettingsSchema)
  async putSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string, @Body({ schema: s.stockSettingsSchema }) b: { adjustmentAccountId?: string | null; openingBalanceAccountId?: string | null }) { return out(await this.settings.putSettings(t, c, b)); }
  @RequirePermissions('stock:read') @Get('companies/:companyId/inventory-accounts')
  async listMap(@TenantId() t: string, @Param('companyId', { schema: id }) c: string) { return { items: (await this.settings.listInventoryAccounts(t, c)).map(out) }; }
  /** Sets the GL account that holds stock of an item type (must be an inventory / WIP control account). */
  @RequirePermissions('stock:manage') @Put('companies/:companyId/inventory-accounts') @ApiZodBody(s.inventoryAccountSchema)
  async putMap(@TenantId() t: string, @Param('companyId', { schema: id }) c: string, @Body({ schema: s.inventoryAccountSchema }) b: { itemType: string; accountId: string }) { return out(await this.settings.mapInventoryAccount(t, c, b.itemType, b.accountId)); }
  @RequirePermissions('stock:manage') @Patch('warehouses/:id/stock-settings') @ApiZodBody(s.warehouseStockSettingsSchema)
  warehouseSettings(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.warehouseStockSettingsSchema }) b: { allowNegativeStock: boolean }) { return this.settings.setWarehouseNegativeStock(t, i, b.allowNegativeStock); }

  // ---- batches and serials ------------------------------------------------------------------------------------
  @RequirePermissions('stock:post') @Idempotent() @Post('items/:id/batches') @ApiZodBody(s.createBatchSchema)
  async createBatch(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.createBatchSchema }) b: s.CreateBatchInput) { return out(await this.settings.createBatch(t, i, b)); }
  @RequirePermissions('stock:read') @Get('items/:id/batches')
  async listBatches(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() }) }) q: { limit: number; cursor?: string }) { const p = await this.settings.listBatches(t, i, q.limit, q.cursor); return { items: p.items.map(out), nextCursor: p.nextCursor }; }
  @RequirePermissions('stock:manage') @Post('batches/:id/status') @HttpCode(200) @ApiZodBody(s.batchStatusSchema)
  async batchStatus(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.batchStatusSchema }) b: { status: 'active' | 'blocked' }) { return out(await this.settings.setBatchStatus(t, i, b.status)); }
  @RequirePermissions('stock:read') @Get('stock/serials')
  async serials(@TenantId() t: string, @Query({ schema: s.listSerialsQuery }) q: z.infer<typeof s.listSerialsQuery>) { const p = await this.queries.listSerials(t, q); return { items: p.items.map(out), nextCursor: p.nextCursor }; }

  // ---- movements ------------------------------------------------------------------------------------------------
  /** Opening stock, receipts, issues and adjustments. Costs, GL entry and balances are all produced in one transaction. */
  @RequirePermissions('stock:post') @Idempotent() @Post('stock/movements') @ApiZodBody(s.postMovementSchema)
  async post(@CurrentPrincipal() a: Principal, @Body({ schema: s.postMovementSchema }) b: s.PostMovementInput) {
    const { movement, results } = await this.stock.moveInTenant(a.tenantId, {
      companyId: b.companyId, movementType: b.movementType, postingDate: b.postingDate, description: b.description, offsetAccountId: b.offsetAccountId, allowControlOffset: false,
      source: { type: 'manual' }, postedBy: a.userId,
      lines: b.lines.map((l) => ({ warehouseId: l.warehouseId, itemId: l.itemId, quantity: l.quantity, direction: b.movementType === 'issue' ? 'out' : b.movementType === 'adjustment' ? (l.direction as 'in' | 'out') : 'in', unitCost: l.unitCost, batchId: l.batchId, batch: l.batch, serialNos: l.serialNos, reservationId: l.reservationId })),
    });
    return { ...hide(movement), lines: results.map((r) => ({ ...hide(r.ledger), serialNos: r.serialNos })) };
  }
  @RequirePermissions('stock:read') @Get('stock/movements')
  async list(@TenantId() t: string, @Query({ schema: s.listMovementsQuery }) q: z.infer<typeof s.listMovementsQuery>) { const p = await this.queries.listMovements(t, q); return { items: p.items.map(hide), nextCursor: p.nextCursor }; }
  @RequirePermissions('stock:read') @Get('stock/movements/:id')
  async get(@TenantId() t: string, @Param('id', { schema: id }) i: string) { const r = await this.queries.getMovement(t, i); return { ...hide(r.movement), lines: r.lines.map(hide) }; }

  // ---- reports ----------------------------------------------------------------------------------------------------
  @RequirePermissions('stock:read') @Get('stock/balances')
  balances(@TenantId() t: string, @Query({ schema: s.balancesQuery }) q: z.infer<typeof s.balancesQuery>) { return this.queries.balances(t, q); }
  @RequirePermissions('stock:read') @Get('stock/card')
  async card(@TenantId() t: string, @Query({ schema: s.stockCardQuery }) q: z.infer<typeof s.stockCardQuery>) { const p = await this.queries.stockCard(t, q); return { items: p.items.map(hide), nextCursor: p.nextCursor }; }
  @RequirePermissions('stock:read') @Get('stock/valuation')
  valuation(@TenantId() t: string, @Query({ schema: s.asOfQuery }) q: { companyId: string; asOf: string }) { return this.queries.valuation(t, q.companyId, q.asOf); }
  /** Stock subledger vs the GL control accounts. */
  @RequirePermissions('stock:read') @Get('inventory/reconciliation')
  reconciliation(@TenantId() t: string, @Query({ schema: s.asOfQuery }) q: { companyId: string; asOf: string }) { return this.queries.reconciliation(t, q.companyId, q.asOf); }
}

@Module({
  imports: [AccountingModule],
  controllers: [InventoryController, StockOperationsController],
  providers: [Recorder, InventorySettingsService, StockService, StockQueriesService, ReservationsService, TransfersService, CountsService],
  exports: [StockService, StockQueriesService, InventorySettingsService, ReservationsService, TransfersService, CountsService],
})
export class InventoryModule {}
