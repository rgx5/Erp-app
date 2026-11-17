import { Controller, Get, Inject, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { RequirePermissions, TenantId } from '../identity/principal.js';
import { PurchasingModule } from '../purchasing/purchasing.controller.js';
import { SalesModule } from '../sales/sales.controller.js';
import { DashboardService } from './dashboard.service.js';

const query = z.object({ companyId: z.uuid(), asOf: z.iso.date().optional() });

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('v1')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  /** Cash, this month and the year so far, what is owed to and by the business, stock value, a monthly trend and what needs attention. */
  @RequirePermissions('dashboard:read') @Get('dashboard')
  summary(@TenantId() t: string, @Query({ schema: query }) q: { companyId: string; asOf?: string }) { return this.dashboard.summary(t, q.companyId, q.asOf ?? new Date().toISOString().slice(0, 10)); }
}

@Module({ imports: [AccountingModule, SalesModule, PurchasingModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
