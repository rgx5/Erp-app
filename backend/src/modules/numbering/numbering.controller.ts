import { Body, Controller, Get, Inject, Module, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody, pageQuerySchema, type PageQuery } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { RequirePermissions, TenantId } from '../identity/principal.js';
import { presentPage } from '../organization/organization.presenters.js';
import { NumberingService, type AllocationRow, type SeriesRow } from './numbering.service.js';

const createSeriesSchema = z.strictObject({
  gstRegistrationId: z.uuid(),
  documentType: z.string().regex(/^[a-z][a-z_]{1,39}$/, 'Use lower-case letters and underscores, e.g. tax_invoice'),
  financialYear: z.string().regex(/^[0-9]{4}-[0-9]{2}$/, 'Use the form 2024-25').refine((fy) => (Number(fy.slice(0, 4)) + 1) % 100 === Number(fy.slice(5)), 'The two years must be consecutive'),
  prefix: z.string().regex(/^[A-Za-z0-9/-]{0,10}$/, 'Up to 10 letters, digits, "/" or "-"').default(''),
  separator: z.enum(['/', '-', '']).default('/'),
  includeFinancialYear: z.boolean().default(true),
  padding: z.number().int().min(1).max(12).default(5),
  startAt: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).default(1),
});

const presentSeries = (s: SeriesRow) => ({
  id: s.id,
  gstRegistrationId: s.gstRegistrationId,
  documentType: s.documentType,
  financialYear: s.financialYear,
  prefix: s.prefix,
  separator: s.separator,
  includeFinancialYear: s.includeFinancialYear,
  padding: s.padding,
  nextValue: s.nextValue,
  status: s.status,
  version: s.version,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});
const presentAllocation = (a: AllocationRow) => ({
  id: a.id,
  seriesId: a.seriesId,
  value: a.value,
  number: a.formatted,
  documentRef: a.documentRef,
  status: a.status,
  cancelReason: a.cancelReason,
  allocatedAt: a.allocatedAt.toISOString(),
  cancelledAt: a.cancelledAt?.toISOString() ?? null,
});

/**
 * Series are configured here. Numbers themselves are taken by documents (later slices) through NumberingService.allocate
 * inside the document's own transaction; there is intentionally no endpoint that hands out numbers on request.
 */
@ApiTags('numbering')
@ApiBearerAuth()
@Controller('v1/number-series')
export class NumberingController {
  constructor(@Inject(NumberingService) private readonly numbering: NumberingService) {}

  @RequirePermissions('numbering:write')
  @Idempotent()
  @Post()
  @ApiZodBody(createSeriesSchema)
  async create(@TenantId() tenantId: string, @Body({ schema: createSeriesSchema }) body: z.infer<typeof createSeriesSchema>) {
    return presentSeries(await this.numbering.createSeries(tenantId, body));
  }

  @RequirePermissions('numbering:read')
  @Get()
  async list(@TenantId() tenantId: string, @Query({ schema: pageQuerySchema }) query: PageQuery) {
    return presentPage(await this.numbering.listSeries(tenantId, query.limit, query.cursor), presentSeries);
  }

  @RequirePermissions('numbering:read')
  @Get(':id')
  async get(@TenantId() tenantId: string, @Param('id', { schema: z.uuid() }) id: string) {
    return presentSeries(await this.numbering.getSeries(tenantId, id));
  }

  /** Every number ever issued from the series, including cancelled ones. */
  @RequirePermissions('numbering:read')
  @Get(':id/allocations')
  async allocations(@TenantId() tenantId: string, @Param('id', { schema: z.uuid() }) id: string, @Query({ schema: pageQuerySchema }) query: PageQuery) {
    await this.numbering.getSeries(tenantId, id);
    return presentPage(await this.numbering.listAllocations(tenantId, id, query.limit, query.cursor), presentAllocation);
  }
}

@Module({ controllers: [NumberingController], providers: [NumberingService], exports: [NumberingService] })
export class NumberingModule {}
