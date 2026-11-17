import { Body, Controller, Get, HttpCode, Inject, Module, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { InventoryModule } from '../inventory/inventory.controller.js';
import { MasterDataModule } from '../masterdata/masterdata.controller.js';
import { NumberingModule } from '../numbering/numbering.controller.js';
import { PurchasingModule } from '../purchasing/purchasing.controller.js';
import { SalesModule } from '../sales/sales.controller.js';
import { RequirePermissions, TenantId } from '../identity/principal.js';
import { SetupService } from './setup.service.js';

const id = z.uuid();
const applySchema = z.strictObject({ gstRegistrationId: z.uuid().optional() });

@ApiTags('setup')
@ApiBearerAuth()
@Controller('v1/companies/:companyId/setup')
export class SetupController {
  constructor(@Inject(SetupService) private readonly setup: SetupService) {}

  /** What is still missing before this company can invoice. */
  @RequirePermissions('organization:read') @Get('status')
  status(@TenantId() t: string, @Param('companyId', { schema: id }) c: string) { return this.setup.status(t, c); }

  /** Completes the standard Indian setup (chart, mappings, accounts for stock, sales and purchases, number series, GST slabs). Repeatable; never overwrites. */
  @RequirePermissions('organization:write', 'accounting:manage', 'stock:manage', 'sales:manage', 'purchasing:manage', 'tax:manage', 'numbering:write')
  @Idempotent() @Post('apply-defaults') @HttpCode(200) @ApiZodBody(applySchema)
  apply(@TenantId() t: string, @Param('companyId', { schema: id }) c: string, @Body({ schema: applySchema }) b: { gstRegistrationId?: string }) { return this.setup.applyDefaults(t, c, b); }
}

@Module({ imports: [AccountingModule, InventoryModule, SalesModule, PurchasingModule, NumberingModule, MasterDataModule], controllers: [SetupController], providers: [SetupService] })
export class SetupModule {}
