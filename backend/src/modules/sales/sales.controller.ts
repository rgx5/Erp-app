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
import * as s from './sales.schemas.js';
import { SalesInvoiceService, type InvoiceLineRow, type InvoiceRow } from './sales-invoice.service.js';
import { ReceivablesService } from './receivables.service.js';
import { SalesOrdersService, type OrderLineRow, type OrderRow, type QuoteRow } from './sales-orders.service.js';
import { SalesSettingsService } from './sales-settings.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row as T & { tenantId?: string };
  return rest as Omit<T, 'tenantId'>;
};
export const presentInvoice = (r: { invoice: InvoiceRow; lines: InvoiceLineRow[]; warnings?: unknown[] }) => ({ ...strip(r.invoice), lines: r.lines.map(strip), ...(r.warnings && r.warnings.length > 0 ? { warnings: r.warnings } : {}) });

@ApiTags('sales')
@ApiBearerAuth()
@Controller('v1')
export class SalesController {
  constructor(
    @Inject(SalesSettingsService) private readonly settings: SalesSettingsService,
    @Inject(SalesInvoiceService) private readonly invoices: SalesInvoiceService,
  ) {}

  @RequirePermissions('sales:read') @Get('companies/:companyId/sales-settings')
  async getSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string) { const r = await this.settings.get(t, c); return r ? strip(r) : { companyId: c }; }
  @RequirePermissions('sales:manage') @Put('companies/:companyId/sales-settings') @ApiZodBody(s.salesSettingsSchema)
  async putSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string, @Body({ schema: s.salesSettingsSchema }) b: s.SalesSettingsInput) { return strip(await this.settings.put(t, c, b)); }

  /** Posts a tax invoice or bill of supply: number, stock at cost, journal, document, atomically. */
  @RequirePermissions('sales:post') @Idempotent() @Post('sales/invoices') @ApiZodBody(s.createInvoiceSchema)
  async create(@CurrentPrincipal() a: Principal, @Body({ schema: s.createInvoiceSchema }) b: s.CreateInvoiceInput) { return presentInvoice(await this.invoices.createInvoice(a.tenantId, a.userId, b)); }
  @RequirePermissions('sales:post') @Idempotent() @Post('sales/credit-notes') @ApiZodBody(s.createNoteSchema)
  async creditNote(@CurrentPrincipal() a: Principal, @Body({ schema: s.createNoteSchema }) b: s.CreateNoteInput) { return presentInvoice(await this.invoices.createCreditNote(a.tenantId, a.userId, b)); }
  @RequirePermissions('sales:post') @Idempotent() @Post('sales/debit-notes') @ApiZodBody(s.createNoteSchema)
  async debitNote(@CurrentPrincipal() a: Principal, @Body({ schema: s.createNoteSchema }) b: s.CreateNoteInput) { return presentInvoice(await this.invoices.createDebitNote(a.tenantId, a.userId, b)); }
  @RequirePermissions('sales:cancel') @Idempotent() @Post('sales/invoices/:id/cancel') @HttpCode(200) @ApiZodBody(s.cancelInvoiceSchema)
  async cancel(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.cancelInvoiceSchema }) b: { cancelDate: string; reason: string }) { return presentInvoice(await this.invoices.cancel(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('sales:read') @Get('sales/invoices')
  async list(@TenantId() t: string, @Query({ schema: s.listInvoicesQuery }) q: s.ListInvoicesQuery) { const p = await this.invoices.list(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('sales:read') @Get('sales/invoices/:id')
  async get(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentInvoice(await this.invoices.get(t, i)); }
}

const presentReceipt = (r: { receipt: object; allocations: object[]; unallocated: string }) => ({ ...strip(r.receipt), allocations: r.allocations.map(strip), unallocated: r.unallocated });
const presentQuote = (r: { quote: QuoteRow; lines: object[] }) => ({ ...strip(r.quote), lines: r.lines.map(strip) });
const presentOrder = (r: { order: OrderRow; lines: OrderLineRow[]; invoices?: object[] }) => ({ ...strip(r.order), lines: r.lines.map(strip), ...(r.invoices ? { invoices: r.invoices } : {}) });

@ApiTags('sales orders')
@ApiBearerAuth()
@Controller('v1/sales')
export class SalesOrdersController {
  constructor(@Inject(SalesOrdersService) private readonly orders: SalesOrdersService) {}

  @RequirePermissions('sales:post') @Idempotent() @Post('quotes') @ApiZodBody(s.createQuoteSchema)
  async createQuote(@CurrentPrincipal() a: Principal, @Body({ schema: s.createQuoteSchema }) b: s.CreateQuoteInput) { return presentQuote(await this.orders.createQuote(a.tenantId, a.userId, b)); }
  @RequirePermissions('sales:read') @Get('quotes')
  async listQuotes(@TenantId() t: string, @Query({ schema: s.listQuotesQuery }) q: z.infer<typeof s.listQuotesQuery>) { const p = await this.orders.listQuotes(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('sales:read') @Get('quotes/:id')
  async getQuote(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentQuote(await this.orders.getQuote(t, i)); }
  @RequirePermissions('sales:post') @Post('quotes/:id/reject') @HttpCode(200)
  async rejectQuote(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentQuote(await this.orders.rejectQuote(t, i)); }
  /** Turns the quote into a sales order (optionally holding the stock). */
  @RequirePermissions('sales:post') @Idempotent() @Post('quotes/:id/convert') @ApiZodBody(s.convertQuoteSchema)
  async convert(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.convertQuoteSchema }) b: { orderDate: string; customerReference?: string; reserveStock: boolean }) { return presentOrder(await this.orders.convertQuote(a.tenantId, a.userId, i, b)); }

  @RequirePermissions('sales:post') @Idempotent() @Post('orders') @ApiZodBody(s.createOrderSchema)
  async createOrder(@CurrentPrincipal() a: Principal, @Body({ schema: s.createOrderSchema }) b: s.CreateOrderInput) { return presentOrder(await this.orders.createOrder(a.tenantId, a.userId, b)); }
  @RequirePermissions('sales:read') @Get('orders')
  async listOrders(@TenantId() t: string, @Query({ schema: s.listOrdersQuery }) q: z.infer<typeof s.listOrdersQuery>) { const p = await this.orders.listOrders(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('sales:read') @Get('orders/:id')
  async getOrder(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentOrder(await this.orders.getOrder(t, i)); }
  /** Invoices what is still outstanding (or the lines given), consuming the stock reserved for the order. */
  @RequirePermissions('sales:post') @Idempotent() @Post('orders/:id/invoice') @ApiZodBody(s.invoiceOrderSchema)
  async invoice(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.invoiceOrderSchema }) b: z.infer<typeof s.invoiceOrderSchema>) { return presentInvoice(await this.orders.invoiceOrder(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('sales:post') @Post('orders/:id/cancel') @HttpCode(200)
  async cancelOrder(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentOrder(await this.orders.cancelOrder(t, i)); }
  @RequirePermissions('sales:post') @Post('orders/:id/close') @HttpCode(200)
  async closeOrder(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentOrder(await this.orders.closeOrder(t, i)); }
}

@ApiTags('receivables')
@ApiBearerAuth()
@Controller('v1/receivables')
export class ReceivablesController {
  constructor(@Inject(ReceivablesService) private readonly receivables: ReceivablesService) {}

  /** Records money received. Allocations are optional: unallocated money stays on account as an advance. */
  @RequirePermissions('receivables:post') @Idempotent() @Post('receipts') @ApiZodBody(s.createReceiptSchema)
  async createReceipt(@CurrentPrincipal() a: Principal, @Body({ schema: s.createReceiptSchema }) b: s.CreateReceiptInput) { return presentReceipt(await this.receivables.createReceipt(a.tenantId, a.userId, b)); }
  @RequirePermissions('receivables:read') @Get('receipts')
  async listReceipts(@TenantId() t: string, @Query({ schema: s.listReceiptsQuery }) q: z.infer<typeof s.listReceiptsQuery>) { const p = await this.receivables.listReceipts(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('receivables:read') @Get('receipts/:id')
  async getReceipt(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentReceipt(await this.receivables.getReceipt(t, i)); }
  @RequirePermissions('receivables:post') @Idempotent() @Post('receipts/:id/cancel') @HttpCode(200) @ApiZodBody(s.cancelReceiptSchema)
  async cancelReceipt(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.cancelReceiptSchema }) b: { cancelDate: string; reason: string }) { return presentReceipt(await this.receivables.cancelReceipt(a.tenantId, a.userId, i, b)); }

  /** Settles invoices from a receipt or a credit note. */
  @RequirePermissions('receivables:post') @Idempotent() @Post('allocations') @ApiZodBody(s.allocateSchema)
  async allocate(@CurrentPrincipal() a: Principal, @Body({ schema: s.allocateSchema }) b: z.infer<typeof s.allocateSchema>) { return { items: (await this.receivables.allocate(a.tenantId, a.userId, b)).map(strip) }; }
  @RequirePermissions('receivables:post') @Post('allocations/:id/reverse') @HttpCode(200) @ApiZodBody(s.reverseAllocationSchema)
  async reverseAllocation(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.reverseAllocationSchema }) b: { on: string; reason: string }) { return strip(await this.receivables.reverseAllocation(t, i, b)); }
  @RequirePermissions('receivables:writeoff') @Idempotent() @Post('write-offs') @ApiZodBody(s.writeOffSchema)
  async writeOff(@CurrentPrincipal() a: Principal, @Body({ schema: s.writeOffSchema }) b: z.infer<typeof s.writeOffSchema>) { return strip(await this.receivables.writeOff(a.tenantId, a.userId, b)); }

  @RequirePermissions('receivables:read') @Get('customers/:id/position')
  position(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.positionQuery }) q: { companyId: string; asOf: string }) { return this.receivables.position(t, q.companyId, i, q.asOf); }
  @RequirePermissions('receivables:read') @Get('customers/:id/statement')
  statement(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: s.statementQuery }) q: { companyId: string; from: string; to: string }) { return this.receivables.statement(t, q.companyId, i, q.from, q.to); }
  @RequirePermissions('receivables:read') @Get('ageing')
  ageing(@TenantId() t: string, @Query({ schema: s.asOfQuery }) q: { companyId: string; asOf: string }) { return this.receivables.ageing(t, q.companyId, q.asOf); }
  /** Receivables documents vs the general ledger, customer by customer. */
  @RequirePermissions('receivables:read') @Get('reconciliation')
  reconciliation(@TenantId() t: string, @Query({ schema: s.asOfQuery }) q: { companyId: string; asOf: string }) { return this.receivables.reconciliation(t, q.companyId, q.asOf); }
}

@Module({
  imports: [AccountingModule, InventoryModule, NumberingModule, MasterDataModule],
  controllers: [SalesController, SalesOrdersController, ReceivablesController],
  providers: [Recorder, SalesSettingsService, SalesInvoiceService, SalesOrdersService, ReceivablesService],
  exports: [SalesSettingsService, SalesInvoiceService, SalesOrdersService, ReceivablesService],
})
export class SalesModule {}
