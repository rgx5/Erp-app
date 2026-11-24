import { Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequiresModule } from '../identity/entitlements.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { NotificationsService } from './notifications.service.js';
import { SalesModule } from '../sales/sales.controller.js';
import { Authenticated } from '../identity/principal.js';
import { allows } from '../identity/permissions.js';
import { ExportService } from './export.service.js';
import { GROUPS, ReportsService } from './reports.service.js';

const salesQuery = z.object({ companyId: z.uuid(), from: z.iso.date(), to: z.iso.date(), groupBy: z.enum(GROUPS).default('item'), categoryId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) })
  .refine((q) => q.from <= q.to, { message: 'The start date is after the end date' });
const dayQuery = z.object({ companyId: z.uuid(), date: z.iso.date(), terminalId: z.uuid().optional() });

@ApiTags('reports')
@ApiBearerAuth()
@Controller('v1/reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService, @Inject(ExportService) private readonly exporter: ExportService) {}

  /** Sales (and profit) by item, category, brand, day, month, cashier or customer for a period. */
  @RequiresModule('sales') @RequirePermissions('sales:read') @Get('sales')
  sales(@TenantId() t: string, @Query({ schema: salesQuery }) q: z.infer<typeof salesQuery>) { return this.reports.sales(t, q); }

  /** The end-of-day summary for the counters. */
  @RequiresModule('pos') @RequirePermissions('pos:read') @Get('day-end')
  dayEnd(@TenantId() t: string, @Query({ schema: dayQuery }) q: z.infer<typeof dayQuery>) { return this.reports.dayEnd(t, q); }

  /** A copy of everything the business has recorded, as one JSON file. Owner-level only. */
  @RequirePermissions('organization:write') @Get('export')
  everything(@TenantId() t: string) { return this.exporter.everything(t); }

  /** Stocked items at or below their reorder level, with a suggested quantity to buy. */
  @RequiresModule('inventory') @RequirePermissions('stock:read') @Get('low-stock')
  lowStock(@TenantId() t: string, @Query({ schema: z.object({ companyId: z.uuid() }) }) q: { companyId: string }) { return this.reports.lowStock(t, q); }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('v1/notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notices: NotificationsService) {}

  /** What needs this person's attention right now: approvals waiting, low stock, overdue customers, a shift left open, recurring invoices, an expiring licence. */
  @Authenticated() @Get()
  async list(@CurrentPrincipal() a: Principal, @Query({ schema: z.object({ companyId: z.uuid() }) }) q: { companyId: string }) {
    const mods = a.entitlements?.restricted ? a.entitlements.modules : null;
    const items = await this.notices.list(a.tenantId, q.companyId, { can: (p) => allows(a.permissions, [p]), has: (m) => !mods || mods.has(m) }, a.entitlements?.expiresAt?.toISOString() ?? null);
    return { items };
  }
}

@Module({ imports: [SalesModule], controllers: [ReportsController, NotificationsController], providers: [ReportsService, ExportService, Recorder, NotificationsService] })
export class ReportsModule {}
