import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { Recorder } from '../masterdata/helpers.js';
import { SalesModule, presentInvoice } from '../sales/sales.controller.js';
import * as s from './pos.schemas.js';
import { PosService } from './pos.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row as T & { tenantId?: string };
  return rest as Omit<T, 'tenantId'>;
};

@ApiTags('pos')
@ApiBearerAuth()
@Controller('v1/pos')
export class PosController {
  constructor(@Inject(PosService) private readonly pos: PosService) {}

  @RequirePermissions('pos:read') @Get('settings')
  async getSettings(@TenantId() t: string, @Query({ schema: s.companyQuery }) q: { companyId: string }) { const r = await this.pos.getSettings(t, q.companyId); return { settings: r.settings ? strip(r.settings) : null, paymentAccounts: r.paymentAccounts.map(strip) }; }
  @RequirePermissions('pos:manage') @Put('settings') @ApiZodBody(s.posSettingsSchema)
  async putSettings(@TenantId() t: string, @Query({ schema: s.companyQuery }) q: { companyId: string }, @Body({ schema: s.posSettingsSchema }) b: { walkInCustomerId?: string | null; cashVarianceAccountId?: string | null }) { return strip(await this.pos.putSettings(t, q.companyId, b)); }
  /** Where each way of paying lands in the ledger. */
  @RequirePermissions('pos:manage') @Put('payment-accounts') @ApiZodBody(s.paymentAccountSchema)
  async mapPayment(@TenantId() t: string, @Query({ schema: s.companyQuery }) q: { companyId: string }, @Body({ schema: s.paymentAccountSchema }) b: { method: 'cash' | 'bank_transfer' | 'upi' | 'card' | 'cheque' | 'other'; accountId: string }) { return strip(await this.pos.mapPayment(t, q.companyId, b.method, b.accountId)); }
  @RequirePermissions('pos:manage') @Idempotent() @Post('terminals') @ApiZodBody(s.createTerminalSchema)
  async createTerminal(@TenantId() t: string, @Body({ schema: s.createTerminalSchema }) b: z.infer<typeof s.createTerminalSchema>) { return strip(await this.pos.createTerminal(t, b)); }
  @RequirePermissions('pos:read') @Get('terminals')
  async terminals(@TenantId() t: string, @Query({ schema: s.companyQuery }) q: { companyId: string }) { return { items: (await this.pos.listTerminals(t, q.companyId)).map(strip) }; }

  @RequirePermissions('pos:sell') @Idempotent() @Post('shifts') @ApiZodBody(s.openShiftSchema)
  async openShift(@CurrentPrincipal() a: Principal, @Body({ schema: s.openShiftSchema }) b: z.infer<typeof s.openShiftSchema>) { return strip(await this.pos.openShift(a.tenantId, a.userId, b)); }
  @RequirePermissions('pos:read') @Get('shifts')
  async listShifts(@TenantId() t: string, @Query({ schema: s.listShiftsQuery }) q: z.infer<typeof s.listShiftsQuery>) { const p = await this.pos.listShifts(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('pos:read') @Get('shifts/:id')
  async getShift(@TenantId() t: string, @Param('id', { schema: id }) i: string) { const r = await this.pos.getShift(t, i); return { ...strip(r.shift), summary: r.summary }; }
  /** Cash-up: counted cash vs expected, with the difference posted to cash over/short. */
  @RequirePermissions('pos:sell') @Idempotent() @Post('shifts/:id/close') @HttpCode(200) @ApiZodBody(s.closeShiftSchema)
  async closeShift(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.closeShiftSchema }) b: { countedCash: string; date?: string }) { const r = await this.pos.closeShift(a.tenantId, a.userId, i, b); return { ...strip(r.shift), summary: r.summary }; }

  /** A counter sale: invoice, stock, ledger and the payments taken at the till, in one transaction. */
  @RequirePermissions('pos:sell') @Idempotent() @Post('sales') @ApiZodBody(s.posSaleSchema)
  async sale(@CurrentPrincipal() a: Principal, @Body({ schema: s.posSaleSchema }) b: s.PosSaleInput) {
    const r = await this.pos.sale(a.tenantId, a.userId, b);
    return { ...strip(r.sale), invoice: presentInvoice({ invoice: r.invoice, lines: r.lines, warnings: r.warnings }), payments: r.payments.map(strip), changeDue: r.changeDue };
  }
  @RequirePermissions('pos:return') @Idempotent() @Post('returns') @ApiZodBody(s.posReturnSchema)
  async ret(@CurrentPrincipal() a: Principal, @Body({ schema: s.posReturnSchema }) b: s.PosReturnInput) {
    const r = await this.pos.return(a.tenantId, a.userId, b);
    return { ...strip(r.sale), creditNote: presentInvoice({ invoice: r.creditNote, lines: r.lines }), payments: r.payments.map(strip) };
  }
  @RequirePermissions('pos:read') @Get('sales')
  async listSales(@TenantId() t: string, @Query({ schema: s.listSalesQuery }) q: z.infer<typeof s.listSalesQuery>) { const p = await this.pos.listSales(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('pos:read') @Get('sales/:id')
  async getSale(@TenantId() t: string, @Param('id', { schema: id }) i: string) { const r = await this.pos.getSale(t, i); return { ...strip(r.sale), document: r.invoice ? presentInvoice({ invoice: r.invoice, lines: r.lines }) : null, payments: r.payments.map(strip) }; }
}

@Module({ imports: [SalesModule, AccountingModule], controllers: [PosController], providers: [Recorder, PosService], exports: [PosService] })
export class PosModule {}
