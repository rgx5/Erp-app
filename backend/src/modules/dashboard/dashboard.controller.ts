import { Controller, Get, Header, Inject, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { Public, RequirePermissions, TenantId } from '../identity/principal.js';
import { PurchasingModule } from '../purchasing/purchasing.controller.js';
import { SalesModule } from '../sales/sales.controller.js';
import { DashboardService } from './dashboard.service.js';
import { OWNER_PAGE } from './owner-page.js';

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

/** The owner's web dashboard. The page is public (it holds no data); everything it shows comes from the signed-in API calls it makes. */
@ApiExcludeController()
@Controller()
export class OwnerWebController {
  @Public() @Get('owner')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
  @Header('X-Content-Type-Options', 'nosniff')
  page(): string { return OWNER_PAGE; }
}

@Module({ imports: [AccountingModule, SalesModule, PurchasingModule], controllers: [DashboardController, OwnerWebController], providers: [DashboardService] })
export class DashboardModule {}
