import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { allows } from '../identity/permissions.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { InventoryModule } from '../inventory/inventory.controller.js';
import { Recorder } from '../masterdata/helpers.js';
import { MasterDataModule } from '../masterdata/masterdata.controller.js';
import { NumberingModule } from '../numbering/numbering.controller.js';
import * as s from './purchasing.schemas.js';
import { PurchaseOrdersService, type GoodsReceiptLineRow, type GoodsReceiptRow, type PurchaseOrderLineRow, type PurchaseOrderRow } from './purchase-orders.service.js';
import { LandedCostService } from './landed-cost.service.js';
import { PayablesService } from './payables.service.js';
import { SupplierBillsService, type BillLineRow, type BillRow } from './supplier-bills.service.js';
import { PurchasingSettingsService } from './purchasing-settings.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row as T & { tenantId?: string };
  return rest as Omit<T, 'tenantId'>;
};
const presentOrder = (r: { order: PurchaseOrderRow; lines: PurchaseOrderLineRow[]; receipts?: object[] }) => ({ ...strip(r.order), lines: r.lines.map(strip), ...(r.receipts ? { receipts: r.receipts } : {}) });
const presentBill = (r: { bill: BillRow; lines: BillLineRow[] }) => ({ ...strip(r.bill), lines: r.lines.map(strip) });
const presentVoucher = (r: { voucher: object; charges: object[]; lines: object[] }) => ({ ...strip(r.voucher), charges: r.charges.map(strip), lines: r.lines.map(strip) });
const presentReceipt = (r: { receipt: GoodsReceiptRow; lines: GoodsReceiptLineRow[] }) => ({ ...strip(r.receipt), lines: r.lines.map(strip) });

@ApiTags('purchasing')
@ApiBearerAuth()
@Controller('v1')
export class PurchasingController {
  constructor(
    @Inject(PurchasingSettingsService) private readonly settings: PurchasingSettingsService,
    @Inject(PurchaseOrdersService) private readonly orders: PurchaseOrdersService,
    @Inject(SupplierBillsService) private readonly bills: SupplierBillsService,
    @Inject(LandedCostService) private readonly landed: LandedCostService,
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

  /** Sends goods back that were received but not yet billed. */
  @RequirePermissions('purchasing:post') @Idempotent() @Post('purchasing/receipts/:id/return') @ApiZodBody(s.returnReceiptSchema)
  async returnReceipt(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.returnReceiptSchema }) b: s.ReturnReceiptInput) { const r = await this.bills.returnReceipt(a.tenantId, a.userId, i, b); return { ...strip(r.return), lines: r.lines.map(strip) }; }
  @RequirePermissions('purchasing:read') @Get('purchasing/returns/:id')
  async getReturn(@TenantId() t: string, @Param('id', { schema: id }) i: string) { const r = await this.bills.getReturn(t, i); return { ...strip(r.return), lines: r.lines.map(strip) }; }

  /** Books a supplier bill: three-way match, GST input credit, GRNI cleared, payable raised, atomically. */
  @RequirePermissions('purchasing:post') @Idempotent() @Post('purchasing/bills') @ApiZodBody(s.createBillSchema)
  async createBill(@CurrentPrincipal() a: Principal, @Body({ schema: s.createBillSchema }) b: s.CreateBillInput) { return presentBill(await this.bills.createBill(a.tenantId, a.userId, b, allows(a.permissions, ['purchasing:approve']))); }
  @RequirePermissions('purchasing:post') @Idempotent() @Post('purchasing/debit-notes') @ApiZodBody(s.createDebitNoteSchema)
  async createDebitNote(@CurrentPrincipal() a: Principal, @Body({ schema: s.createDebitNoteSchema }) b: s.CreateDebitNoteInput) { return presentBill(await this.bills.createDebitNote(a.tenantId, a.userId, b)); }
  @RequirePermissions('purchasing:cancel') @Idempotent() @Post('purchasing/bills/:id/cancel') @HttpCode(200) @ApiZodBody(s.cancelBillSchema)
  async cancelBill(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.cancelBillSchema }) b: { cancelDate: string; reason: string }) { return presentBill(await this.bills.cancel(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('purchasing:read') @Get('purchasing/bills')
  async listBills(@TenantId() t: string, @Query({ schema: s.listBillsQuery }) q: z.infer<typeof s.listBillsQuery>) { const p = await this.bills.list(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('purchasing:read') @Get('purchasing/bills/:id')
  async getBill(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentBill(await this.bills.get(t, i)); }

  /** Moves freight, duty and insurance that were booked as expenses into the cost of the goods received. */
  @RequirePermissions('purchasing:post') @Idempotent() @Post('purchasing/landed-costs') @ApiZodBody(s.createLandedCostSchema)
  async createLandedCost(@CurrentPrincipal() a: Principal, @Body({ schema: s.createLandedCostSchema }) b: s.CreateLandedCostInput) { return presentVoucher(await this.landed.create(a.tenantId, a.userId, b)); }
  @RequirePermissions('purchasing:read') @Get('purchasing/landed-costs')
  async listLandedCosts(@TenantId() t: string, @Query({ schema: s.listLandedCostsQuery }) q: z.infer<typeof s.listLandedCostsQuery>) { const p = await this.landed.list(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('purchasing:read') @Get('purchasing/landed-costs/:id')
  async getLandedCost(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentVoucher(await this.landed.get(t, i)); }
  @RequirePermissions('purchasing:cancel') @Idempotent() @Post('purchasing/landed-costs/:id/cancel') @HttpCode(200) @ApiZodBody(s.cancelLandedCostSchema)
  async cancelLandedCost(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.cancelLandedCostSchema }) b: { cancelDate: string; reason: string }) { return presentVoucher(await this.landed.cancel(a.tenantId, a.userId, i, b)); }

  /** Goods received but not yet invoiced, as of a date. */
  @RequirePermissions('purchasing:read') @Get('purchasing/grni')
  grni(@TenantId() t: string, @Query({ schema: s.grniQuery }) q: { companyId: string; asOf: string }) { return this.orders.grniReport(t, q.companyId, q.asOf); }
}

const presentPayment = (r: { payment: object; allocations: object[]; unallocated: string }) => ({ ...strip(r.payment), allocations: r.allocations.map(strip), unallocated: r.unallocated });

@ApiTags('payables')
@ApiBearerAuth()
@Controller('v1/payables')
export class PayablesController {
  constructor(@Inject(PayablesService) private readonly payables: PayablesService) {}

  /** Records money paid to a supplier. Allocations are optional: unallocated money stays on account as an advance. */
  @RequirePermissions('payables:post') @Idempotent() @Post('payments') @ApiZodBody(s.createPaymentSchema)
  async createPayment(@CurrentPrincipal() a: Principal, @Body({ schema: s.createPaymentSchema }) b: s.CreatePaymentInput) { return presentPayment(await this.payables.createPayment(a.tenantId, a.userId, b)); }
  @RequirePermissions('payables:read') @Get('payments')
  async listPayments(@TenantId() t: string, @Query({ schema: s.listPaymentsQuery }) q: z.infer<typeof s.listPaymentsQuery>) { const p = await this.payables.listPayments(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('payables:read') @Get('payments/:id')
  async getPayment(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentPayment(await this.payables.getPayment(t, i)); }
  @RequirePermissions('payables:cancel') @Idempotent() @Post('payments/:id/cancel') @HttpCode(200) @ApiZodBody(s.cancelPaymentSchema)
  async cancelPayment(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.cancelPaymentSchema }) b: { cancelDate: string; reason: string }) { return presentPayment(await this.payables.cancelPayment(a.tenantId, a.userId, i, b)); }

  /** Settles bills from a payment or a debit note. */
  @RequirePermissions('payables:post') @Idempotent() @Post('allocations') @ApiZodBody(s.allocatePaymentsSchema)
  async allocate(@CurrentPrincipal() a: Principal, @Body({ schema: s.allocatePaymentsSchema }) b: z.infer<typeof s.allocatePaymentsSchema>) { return { items: (await this.payables.allocate(a.tenantId, a.userId, b)).map(strip) }; }
  @RequirePermissions('payables:post') @Post('allocations/:id/reverse') @HttpCode(200) @ApiZodBody(s.reversePayableAllocationSchema)
  async reverseAllocation(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.reversePayableAllocationSchema }) b: { on: string; reason: string }) { return strip(await this.payables.reverseAllocation(t, i, b)); }

  /** Money received back from a supplier out of an advance or an unapplied debit note. */
  @RequirePermissions('payables:post') @Idempotent() @Post('refunds') @ApiZodBody(s.supplierRefundSchema)
  async refund(@CurrentPrincipal() a: Principal, @Body({ schema: s.supplierRefundSchema }) b: s.SupplierRefundInput) { return strip(await this.payables.refund(a.tenantId, a.userId, b)); }

  @RequirePermissions('payables:read') @Get('suppliers/:id/position')
  position(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.payablesAsOfQuery }) q: { companyId: string; asOf: string }) { return this.payables.position(t, q.companyId, i, q.asOf); }
  @RequirePermissions('payables:read') @Get('suppliers/:id/statement')
  statement(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.payablesStatementQuery }) q: { companyId: string; from: string; to: string }) { return this.payables.statement(t, q.companyId, i, q.from, q.to); }
  @RequirePermissions('payables:read') @Get('ageing')
  ageing(@TenantId() t: string, @Query({ schema: s.payablesAsOfQuery }) q: { companyId: string; asOf: string }) { return this.payables.ageing(t, q.companyId, q.asOf); }
  /** Payables documents vs the general ledger, supplier by supplier. */
  @RequirePermissions('payables:read') @Get('reconciliation')
  reconciliation(@TenantId() t: string, @Query({ schema: s.payablesAsOfQuery }) q: { companyId: string; asOf: string }) { return this.payables.reconciliation(t, q.companyId, q.asOf); }
}

@Module({
  imports: [AccountingModule, InventoryModule, NumberingModule, MasterDataModule],
  controllers: [PurchasingController, PayablesController],
  providers: [Recorder, PurchasingSettingsService, PurchaseOrdersService, SupplierBillsService, PayablesService, LandedCostService],
  exports: [PurchasingSettingsService, PurchaseOrdersService, SupplierBillsService, PayablesService, LandedCostService],
})
export class PurchasingModule {}
