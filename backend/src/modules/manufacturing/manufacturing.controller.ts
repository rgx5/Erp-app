import { Body, Controller, Get, HttpCode, Inject, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
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
import { CostingService } from './costing.service.js';
import { ManufacturingMastersService } from './masters.service.js';
import { ManufacturingSettingsService } from './manufacturing-settings.service.js';
import { WorkOrdersService } from './work-orders.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => {
  const { tenantId: _t, ...rest } = row as T & { tenantId?: string };
  return rest as Omit<T, 'tenantId'>;
};
const presentWorkOrder = (r: { workOrder: object; materials: object[]; operations: object[]; transactions: object[]; cost: object }) => ({ ...strip(r.workOrder), materials: r.materials.map(strip), operations: r.operations.map(strip), transactions: r.transactions.map(strip), cost: r.cost });
const presentBom = (r: { bom: object; lines: object[]; operations: object[] }) => ({ ...strip(r.bom), lines: r.lines.map(strip), operations: r.operations.map(strip) });

@ApiTags('manufacturing')
@ApiBearerAuth()
@Controller('v1/manufacturing')
export class ManufacturingController {
  constructor(
    @Inject(ManufacturingMastersService) private readonly masters: ManufacturingMastersService,
    @Inject(ManufacturingSettingsService) private readonly settings: ManufacturingSettingsService,
    @Inject(WorkOrdersService) private readonly orders: WorkOrdersService,
    @Inject(CostingService) private readonly costing: CostingService,
  ) {}

  @RequirePermissions('manufacturing:read') @Get('companies/:companyId/settings')
  async getSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string) { const r = await this.settings.get(t, c); return r ? strip(r) : { companyId: c }; }
  @RequirePermissions('manufacturing:manage') @Put('companies/:companyId/settings') @ApiZodBody(s.manufacturingSettingsSchema)
  async putSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string, @Body({ schema: s.manufacturingSettingsSchema }) b: s.ManufacturingSettingsInput) { return strip(await this.settings.put(t, c, b)); }

  @RequirePermissions('manufacturing:produce') @Idempotent() @Post('work-orders') @ApiZodBody(s.createWorkOrderSchema)
  async createWorkOrder(@CurrentPrincipal() a: Principal, @Body({ schema: s.createWorkOrderSchema }) b: s.CreateWorkOrderInput) { return presentWorkOrder(await this.orders.create(a.tenantId, a.userId, b)); }
  @RequirePermissions('manufacturing:read') @Get('work-orders')
  async listWorkOrders(@TenantId() t: string, @Query({ schema: s.listWorkOrdersQuery }) q: z.infer<typeof s.listWorkOrdersQuery>) { const p = await this.orders.list(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('manufacturing:read') @Get('wip-reconciliation')
  wip(@TenantId() t: string, @Query({ schema: s.wipQuery }) q: { companyId: string; asOf: string }) { return this.orders.wipReconciliation(t, q.companyId, q.asOf); }
  /** What an item should cost at today's stock costs and work-centre rates (analytical; nothing is posted). */
  @RequirePermissions('manufacturing:read') @Get('costing/rollup')
  rollup(@TenantId() t: string, @Query({ schema: s.rollupQuery }) q: z.infer<typeof s.rollupQuery>) { return this.costing.rollup(t, q.companyId, q.itemId, q.quantity, q.date); }
  @RequirePermissions('manufacturing:read') @Get('costing/variances')
  variances(@TenantId() t: string, @Query({ schema: s.variancesQuery }) q: z.infer<typeof s.variancesQuery>) { return this.costing.variances(t, q.companyId, q.from, q.to, q.itemId); }
  @RequirePermissions('manufacturing:read') @Get('work-orders/:id/variance')
  workOrderVariance(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return this.costing.workOrderVariance(t, i); }
  @RequirePermissions('manufacturing:read') @Get('work-orders/:id')
  async getWorkOrder(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentWorkOrder(await this.orders.get(t, i)); }
  @RequirePermissions('manufacturing:produce') @Idempotent() @Post('work-orders/:id/release') @HttpCode(200)
  async release(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentWorkOrder(await this.orders.release(t, i)); }
  @RequirePermissions('manufacturing:cancel') @Idempotent() @Post('work-orders/:id/cancel') @HttpCode(200)
  async cancelWorkOrder(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentWorkOrder(await this.orders.cancel(t, i)); }
  @RequirePermissions('manufacturing:produce') @Idempotent() @Post('work-orders/:id/issue-materials') @HttpCode(200) @ApiZodBody(s.issueMaterialsSchema)
  async issue(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.issueMaterialsSchema }) b: s.IssueMaterialsInput) { return presentWorkOrder(await this.orders.issueMaterials(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('manufacturing:produce') @Idempotent() @Post('work-orders/:id/return-materials') @HttpCode(200) @ApiZodBody(s.returnMaterialsSchema)
  async returnMaterials(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.returnMaterialsSchema }) b: s.IssueMaterialsInput) { return presentWorkOrder(await this.orders.returnMaterials(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('manufacturing:produce') @Idempotent() @Post('work-orders/:id/report-time') @HttpCode(200) @ApiZodBody(s.reportTimeSchema)
  async reportTime(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.reportTimeSchema }) b: s.ReportTimeInput) { return presentWorkOrder(await this.orders.reportTime(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('manufacturing:produce') @Idempotent() @Post('work-orders/:id/report-output') @HttpCode(200) @ApiZodBody(s.reportOutputSchema)
  async reportOutput(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.reportOutputSchema }) b: s.ReportOutputInput) { return presentWorkOrder(await this.orders.reportOutput(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('manufacturing:produce') @Idempotent() @Post('work-orders/:id/complete') @HttpCode(200) @ApiZodBody(s.completeWorkOrderSchema)
  async complete(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.completeWorkOrderSchema }) b: { date: string }) { return presentWorkOrder(await this.orders.complete(a.tenantId, a.userId, i, b.date)); }

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
  providers: [Recorder, ManufacturingMastersService, ManufacturingSettingsService, WorkOrdersService, CostingService],
  exports: [ManufacturingMastersService, ManufacturingSettingsService, WorkOrdersService, CostingService],
})
export class ManufacturingModule {}
