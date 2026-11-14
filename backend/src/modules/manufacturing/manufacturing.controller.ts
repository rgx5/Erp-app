import { Body, Controller, Get, HttpCode, Inject, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { InventoryModule } from '../inventory/inventory.controller.js';
import { Recorder } from '../masterdata/helpers.js';
import { MasterDataModule } from '../masterdata/masterdata.controller.js';
import * as s from './manufacturing.schemas.js';
import { ManufacturingMastersService } from './masters.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row as T & { tenantId?: string };
  return rest as Omit<T, 'tenantId'>;
};
const presentBom = (r: { bom: object; lines: object[]; operations: object[] }) => ({ ...strip(r.bom), lines: r.lines.map(strip), operations: r.operations.map(strip) });

@ApiTags('manufacturing')
@ApiBearerAuth()
@Controller('v1/manufacturing')
export class ManufacturingController {
  constructor(@Inject(ManufacturingMastersService) private readonly masters: ManufacturingMastersService) {}

  @RequirePermissions('manufacturing:manage') @Post('work-centres') @ApiZodBody(s.createWorkCentreSchema)
  async createWorkCentre(@TenantId() t: string, @Body({ schema: s.createWorkCentreSchema }) b: s.CreateWorkCentreInput) { return strip(await this.masters.createWorkCentre(t, b)); }
  @RequirePermissions('manufacturing:manage') @Patch('work-centres/:id') @ApiZodBody(s.updateWorkCentreSchema)
  async updateWorkCentre(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.updateWorkCentreSchema }) b: s.UpdateWorkCentreInput) { return strip(await this.masters.updateWorkCentre(t, i, b)); }
  @RequirePermissions('manufacturing:read') @Get('work-centres')
  async listWorkCentres(@TenantId() t: string, @Query({ schema: s.listWorkCentresQuery }) q: z.infer<typeof s.listWorkCentresQuery>) { const p = await this.masters.listWorkCentres(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('manufacturing:read') @Get('work-centres/:id')
  async getWorkCentre(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return strip(await this.masters.getWorkCentre(t, i)); }

  @RequirePermissions('manufacturing:manage') @Idempotent() @Post('boms') @ApiZodBody(s.createBomSchema)
  async createBom(@CurrentPrincipal() a: Principal, @Body({ schema: s.createBomSchema }) b: s.CreateBomInput) { return presentBom(await this.masters.createBom(a.tenantId, a.userId, b)); }
  @RequirePermissions('manufacturing:read') @Get('boms')
  async listBoms(@TenantId() t: string, @Query({ schema: s.listBomsQuery }) q: z.infer<typeof s.listBomsQuery>) { const p = await this.masters.listBoms(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('manufacturing:read') @Get('boms/explode')
  explode(@TenantId() t: string, @Query({ schema: s.explodeQuery }) q: z.infer<typeof s.explodeQuery>) { return this.masters.explode(t, q.companyId, q.itemId, q.quantity, q.date); }
  @RequirePermissions('manufacturing:read') @Get('boms/:id')
  async getBom(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentBom(await this.masters.getBom(t, i)); }
  @RequirePermissions('manufacturing:manage') @Post('boms/:id/obsolete') @HttpCode(200) @ApiZodBody(s.obsoleteBomSchema)
  async obsolete(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.obsoleteBomSchema }) b: { effectiveTo?: string | undefined }) { return presentBom(await this.masters.obsoleteBom(t, i, b.effectiveTo)); }
}

@Module({
  imports: [AccountingModule, InventoryModule, MasterDataModule],
  controllers: [ManufacturingController],
  providers: [Recorder, ManufacturingMastersService],
  exports: [ManufacturingMastersService],
})
export class ManufacturingModule {}
