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

@Module({
  imports: [AccountingModule, InventoryModule, NumberingModule, MasterDataModule],
  controllers: [SalesController, SalesOrdersController],
  providers: [Recorder, SalesSettingsService, SalesInvoiceService, SalesOrdersService],
  exports: [SalesSettingsService, SalesInvoiceService, SalesOrdersService],
})
export class SalesModule {}
