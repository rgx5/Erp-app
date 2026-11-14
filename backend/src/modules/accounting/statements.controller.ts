import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { StatementsService } from './statements.service.js';
import { YearEndService } from './year-end.service.js';

const id = z.uuid();
const isoDate = z.iso.date();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => { const { tenantId: _t, ...rest } = row as T & { tenantId?: string }; return rest as Omit<T, 'tenantId'>; };
const settingsSchema = z.strictObject({ retainedEarningsAccountId: z.uuid().nullable().optional() });
const mappingSchema = z.strictObject({ items: z.array(z.strictObject({ accountId: z.uuid(), lineCode: z.string().regex(/^(BS|PL)\.[A-Z_]+$/) })).min(1).max(500) });
const plQuery = z.object({ companyId: z.uuid(), from: isoDate, to: isoDate, compareFrom: isoDate.optional(), compareTo: isoDate.optional() }).refine((v) => v.to >= v.from, { path: ['to'], message: 'Must not be before from' }).refine((v) => !!v.compareFrom === !!v.compareTo, { path: ['compareTo'], message: 'Send both compareFrom and compareTo' });
const bsQuery = z.object({ companyId: z.uuid(), asOf: isoDate, compareAsOf: isoDate.optional() });
const cfQuery = z.object({ companyId: z.uuid(), from: isoDate, to: isoDate }).refine((v) => v.to >= v.from, { path: ['to'], message: 'Must not be before from' });
const companyQuery = z.object({ companyId: z.uuid() });
const reopenSchema = z.strictObject({ reason: z.string().trim().min(1).max(300) });

@ApiTags('financial statements')
@ApiBearerAuth()
@Controller('v1/accounting')
export class StatementsController {
  constructor(
    @Inject(StatementsService) private readonly statements: StatementsService,
    @Inject(YearEndService) private readonly yearEnd: YearEndService,
  ) {}

  @RequirePermissions('accounting:read') @Get('companies/:companyId/settings')
  async getSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string) { const r = await this.statements.getSettings(t, c); return r ? strip(r) : { companyId: c }; }
  @RequirePermissions('accounting:manage') @Put('companies/:companyId/settings') @ApiZodBody(settingsSchema)
  async putSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string, @Body({ schema: settingsSchema }) b: { retainedEarningsAccountId?: string | null | undefined }) { return strip(await this.statements.putSettings(t, c, b)); }

  @RequirePermissions('accounting:read') @Get('statements/mapping')
  mapping(@TenantId() t: string, @Query({ schema: companyQuery }) q: { companyId: string }) { return this.statements.mapping(t, q.companyId); }
  @RequirePermissions('accounting:manage') @Put('statements/mapping') @ApiZodBody(mappingSchema)
  putMapping(@TenantId() t: string, @Query({ schema: companyQuery }) q: { companyId: string }, @Body({ schema: mappingSchema }) b: z.infer<typeof mappingSchema>) { return this.statements.putMapping(t, q.companyId, b.items); }
  /** Maps the template chart's accounts (by code) that have no mapping yet. */
  @RequirePermissions('accounting:manage') @Post('statements/mapping/apply-template') @HttpCode(200)
  applyTemplate(@TenantId() t: string, @Query({ schema: companyQuery }) q: { companyId: string }) { return this.statements.applyTemplate(t, q.companyId); }

  @RequirePermissions('accounting:read') @Get('statements/profit-loss')
  profitLoss(@TenantId() t: string, @Query({ schema: plQuery }) q: z.infer<typeof plQuery>) { return this.statements.profitLoss(t, q.companyId, q.from, q.to, q.compareFrom && q.compareTo ? { from: q.compareFrom, to: q.compareTo } : undefined); }
  @RequirePermissions('accounting:read') @Get('statements/balance-sheet')
  balanceSheet(@TenantId() t: string, @Query({ schema: bsQuery }) q: z.infer<typeof bsQuery>) { return this.statements.balanceSheet(t, q.companyId, q.asOf, q.compareAsOf); }
  @RequirePermissions('accounting:read') @Get('statements/cash-flow')
  cashFlow(@TenantId() t: string, @Query({ schema: cfQuery }) q: z.infer<typeof cfQuery>) { return this.statements.cashFlow(t, q.companyId, q.from, q.to); }

  /** Closes the fiscal year: income and expense accounts are zeroed into retained earnings by one journal entry. */
  @RequirePermissions('accounting:close_year') @Idempotent() @Post('fiscal-years/:id/close-year') @HttpCode(200)
  async closeYear(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string) { return strip(await this.yearEnd.close(a.tenantId, a.userId, i)); }
  @RequirePermissions('accounting:close_year') @Idempotent() @Post('fiscal-years/:id/reopen-year') @HttpCode(200) @ApiZodBody(reopenSchema)
  async reopenYear(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: reopenSchema }) b: { reason: string }) { return strip(await this.yearEnd.reopen(a.tenantId, a.userId, i, b.reason)); }
  @RequirePermissions('accounting:read') @Get('year-end-closings')
  async closings(@TenantId() t: string, @Query({ schema: companyQuery }) q: { companyId: string }) { return { items: (await this.yearEnd.list(t, q.companyId)).map(strip) }; }
}
