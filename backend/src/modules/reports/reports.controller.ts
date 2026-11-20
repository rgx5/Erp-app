import { Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequiresModule } from '../identity/entitlements.js';
import { RequirePermissions, TenantId } from '../identity/principal.js';
import { GROUPS, ReportsService } from './reports.service.js';

const salesQuery = z.object({ companyId: z.uuid(), from: z.iso.date(), to: z.iso.date(), groupBy: z.enum(GROUPS).default('item'), categoryId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) })
  .refine((q) => q.from <= q.to, { message: 'The start date is after the end date' });
const dayQuery = z.object({ companyId: z.uuid(), date: z.iso.date(), terminalId: z.uuid().optional() });

@ApiTags('reports')
@ApiBearerAuth()
@Controller('v1/reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  /** Sales (and profit) by item, category, brand, day, month, cashier or customer for a period. */
  @RequiresModule('sales') @RequirePermissions('sales:read') @Get('sales')
  sales(@TenantId() t: string, @Query({ schema: salesQuery }) q: z.infer<typeof salesQuery>) { return this.reports.sales(t, q); }

  /** The end-of-day summary for the counters. */
  @RequiresModule('pos') @RequirePermissions('pos:read') @Get('day-end')
  dayEnd(@TenantId() t: string, @Query({ schema: dayQuery }) q: z.infer<typeof dayQuery>) { return this.reports.dayEnd(t, q); }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
