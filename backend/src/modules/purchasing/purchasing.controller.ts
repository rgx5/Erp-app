import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { InventoryModule } from '../inventory/inventory.controller.js';
import { Recorder } from '../masterdata/helpers.js';
import { MasterDataModule } from '../masterdata/masterdata.controller.js';
import { NumberingModule } from '../numbering/numbering.controller.js';
import * as s from './purchasing.schemas.js';
import { PurchaseOrdersService, type GoodsReceiptLineRow, type GoodsReceiptRow, type PurchaseOrderLineRow, type PurchaseOrderRow } from './purchase-orders.service.js';
import { PurchasingSettingsService } from './purchasing-settings.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row as T & { tenantId?: string };
  return rest as Omit<T, 'tenantId'>;
};
const presentOrder = (r: { order: PurchaseOrderRow; lines: PurchaseOrderLineRow[]; receipts?: object[] }) => ({ ...strip(r.order), lines: r.lines.map(strip), ...(r.receipts ? { receipts: r.receipts } : {}) });
const presentReceipt = (r: { receipt: GoodsReceiptRow; lines: GoodsReceiptLineRow[] }) => ({ ...strip(r.receipt), lines: r.lines.map(strip) });

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('v1')
export class PurchasingController {
  constructor(
    @Inject(PurchasingSettingsService) private readonly settings: PurchasingSettingsService,
    @Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService,
  ) {}

  @RequirePermissions('purchasing:read') @Get('companies/:companyId/purchasing-settings')
  async getSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string) { const r = await this.settings.get(t, c); return r ? strip(r) : { companyId: c }; }
  @RequirePermissions('purchasing:manage') @Put('companies/:companyId/purchasing-settings') @ApiZodBody(s.purchasingSettingsSchema)
  async putSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string, @Body({ schema: s.purchasingSettingsSchema }) b: s.PurchasingSettingsInput) { return strip(await this.settings.put(t, c, b)); }

  @RequirePermissions('purchasing:post') @Idempotent() @Post('purchasing/orders') @ApiZodBody(s.createPurchaseOrderSchema)
  async createOrder(@CurrentPrincipal() a: Principal, @Body({ schema: s.createPurchaseOrderSchema }) b: s.CreatePurchaseOrderInput) { return presentOrder(await this.orders.createOrder(a.tenantId, a.userId, b)); }
  @RequirePermissions('purchasing:read') @Get('purchasing/orders')
  async listOrders(@TenantId() t: string, @Query({ schema: s.listPurchaseOrdersQuery }) q: z.infer<typeof s.listPurchaseOrdersQuery>) { const p = await this.orders.listOrders(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('purchasing:read') @Get('purchasing/orders/:id')
  async getOrder(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentOrder(await this.orders.getOrder(t, i)); }
  @RequirePermissions('purchasing:cancel') @Idempotent() @Post('purchasing/orders/:id/cancel') @HttpCode(200)
  async cancelOrder(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentOrder(await this.orders.cancelOrder(t, i)); }
  @RequirePermissions('purchasing:post') @Idempotent() @Post('purchasing/orders/:id/close') @HttpCode(200)
  async closeOrder(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentOrder(await this.orders.closeOrder(t, i)); }

  /** Receives goods: stock in at the order price, GRNI accrued, atomically. */
  @RequirePermissions('purchasing:post') @Idempotent() @Post('purchasing/receipts') @ApiZodBody(s.createGoodsReceiptSchema)
  async receive(@CurrentPrincipal() a: Principal, @Body({ schema: s.createGoodsReceiptSchema }) b: s.CreateGoodsReceiptInput) { return presentReceipt(await this.orders.receive(a.tenantId, a.userId, b)); }
  @RequirePermissions('purchasing:read') @Get('purchasing/receipts')
  async listReceipts(@TenantId() t: string, @Query({ schema: s.listGoodsReceiptsQuery }) q: z.infer<typeof s.listGoodsReceiptsQuery>) { const p = await this.orders.listReceipts(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('purchasing:read') @Get('purchasing/receipts/:id')
  async getReceipt(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentReceipt(await this.orders.getReceipt(t, i)); }

  /** Goods received but not yet invoiced, as of a date. */
  @RequirePermissions('purchasing:read') @Get('purchasing/grni')
  grni(@TenantId() t: string, @Query({ schema: s.grniQuery }) q: { companyId: string; asOf: string }) { return this.orders.grniReport(t, q.companyId, q.asOf); }
}

@Module({
  imports: [AccountingModule, InventoryModule, NumberingModule, MasterDataModule],
  controllers: [PurchasingController],
  providers: [Recorder, PurchasingSettingsService, PurchaseOrdersService],
  exports: [PurchasingSettingsService, PurchaseOrdersService],
})
export class PurchasingModule {}
