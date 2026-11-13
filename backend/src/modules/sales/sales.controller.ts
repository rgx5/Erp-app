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

@Module({
  imports: [AccountingModule, InventoryModule, NumberingModule, MasterDataModule],
  controllers: [SalesController],
  providers: [Recorder, SalesSettingsService, SalesInvoiceService],
  exports: [SalesSettingsService, SalesInvoiceService],
})
export class SalesModule {}
