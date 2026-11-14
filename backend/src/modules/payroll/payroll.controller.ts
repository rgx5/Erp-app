import { Body, Controller, Get, HttpCode, Inject, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { PayrollMastersService } from './masters.service.js';
import * as s from './payroll.schemas.js';
import { PayrollRunsService } from './runs.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => { const { tenantId: _t, ...rest } = row as T & { tenantId?: string }; return rest as Omit<T, 'tenantId'>; };
const presentRun = (r: { run: object; payslips: object[] }) => ({ ...strip(r.run), payslips: r.payslips.map(strip) });

@ApiTags('payroll')
@ApiBearerAuth()
@Controller('v1/payroll')
export class PayrollController {
  constructor(
    @Inject(PayrollMastersService) private readonly masters: PayrollMastersService,
    @Inject(PayrollRunsService) private readonly runs: PayrollRunsService,
  ) {}

  @RequirePermissions('payroll:read') @Get('companies/:companyId/settings')
  async getSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string) { const r = await this.masters.getSettings(t, c); return r ? strip(r) : { companyId: c }; }
  @RequirePermissions('payroll:manage') @Put('companies/:companyId/settings') @ApiZodBody(s.payrollSettingsSchema)
  async putSettings(@TenantId() t: string, @Param('companyId', { schema: id }) c: string, @Body({ schema: s.payrollSettingsSchema }) b: s.PayrollSettingsInput) { return strip(await this.masters.putSettings(t, c, b)); }

  // people
  @RequirePermissions('payroll:manage') @Idempotent() @Post('employees') @ApiZodBody(s.createEmployeeSchema)
  async createEmployee(@TenantId() t: string, @Body({ schema: s.createEmployeeSchema }) b: s.CreateEmployeeInput) { return strip(await this.masters.createEmployee(t, b)); }
  @RequirePermissions('payroll:read') @Get('employees')
  async listEmployees(@TenantId() t: string, @Query({ schema: s.listEmployeesQuery }) q: z.infer<typeof s.listEmployeesQuery>) { const p = await this.masters.listEmployees(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('payroll:read') @Get('employees/:id')
  async getEmployee(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return strip(await this.masters.getEmployee(t, i)); }
  @RequirePermissions('payroll:manage') @Patch('employees/:id') @ApiZodBody(s.updateEmployeeSchema)
  async updateEmployee(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.updateEmployeeSchema }) b: s.UpdateEmployeeInput) { return strip(await this.masters.updateEmployee(t, i, b)); }
  @RequirePermissions('payroll:manage') @Post('employees/:id/exit') @HttpCode(200) @ApiZodBody(s.exitEmployeeSchema)
  async exitEmployee(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.exitEmployeeSchema }) b: { dateOfLeaving: string }) { return strip(await this.masters.exitEmployee(t, i, b.dateOfLeaving)); }
  @RequirePermissions('payroll:read') @Get('employees/:id/payslips')
  async payslipsOf(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return { items: (await this.runs.payslipsOf(t, i)).map(strip) }; }

  // components and structures
  @RequirePermissions('payroll:manage') @Post('components') @ApiZodBody(s.createComponentSchema)
  async createComponent(@TenantId() t: string, @Body({ schema: s.createComponentSchema }) b: s.CreateComponentInput) { return strip(await this.masters.createComponent(t, b)); }
  @RequirePermissions('payroll:read') @Get('components')
  async listComponents(@TenantId() t: string, @Query({ schema: s.listComponentsQuery }) q: { companyId: string }) { return { items: (await this.masters.listComponents(t, q.companyId)).map(strip) }; }
  @RequirePermissions('payroll:manage') @Patch('components/:id') @ApiZodBody(s.updateComponentSchema)
  async updateComponent(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Body({ schema: s.updateComponentSchema }) b: { name?: string | undefined; status?: 'active' | 'inactive' | undefined }) { return strip(await this.masters.updateComponent(t, i, b)); }
  @RequirePermissions('payroll:manage') @Idempotent() @Post('employees/:id/structures') @ApiZodBody(s.createStructureSchema)
  async createStructure(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.createStructureSchema }) b: s.CreateStructureInput) { const r = await this.masters.createStructure(a.tenantId, a.userId, i, b); return { ...strip(r.structure), lines: r.lines.map(strip) }; }
  @RequirePermissions('payroll:read') @Get('employees/:id/structures')
  async listStructures(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return { items: (await this.masters.listStructures(t, i)).map((x) => ({ ...strip(x), lines: x.lines.map(strip) })) }; }

  // monthly inputs
  @RequirePermissions('payroll:process') @Put('employees/:id/inputs/:period') @ApiZodBody(s.putInputSchema)
  async putInput(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Param('period', { schema: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }) p: string, @Body({ schema: s.putInputSchema }) b: s.PutInputInput) { return strip(await this.masters.putInput(t, i, p, b)); }
  @RequirePermissions('payroll:read') @Get('inputs')
  async listInputs(@TenantId() t: string, @Query({ schema: s.inputsQuery }) q: { companyId: string; period: string }) { return { items: (await this.masters.listInputs(t, q.companyId, q.period)).map(strip) }; }

  // statutory rules
  @RequirePermissions('payroll:manage') @Put('rules/rates') @ApiZodBody(s.putRatesSchema)
  putRates(@TenantId() t: string, @Body({ schema: s.putRatesSchema }) b: s.PutRatesInput) { return this.masters.putRates(t, b); }
  @RequirePermissions('payroll:manage') @Put('rules/slabs') @ApiZodBody(s.putSlabsSchema)
  putSlabs(@TenantId() t: string, @Body({ schema: s.putSlabsSchema }) b: s.PutSlabsInput) { return this.masters.putSlabs(t, b); }
  /** Starting values for 2025-26: confirm them with your accountant. */
  @RequirePermissions('payroll:manage') @Post('rules/seed-defaults') @HttpCode(200)
  seed(@TenantId() t: string, @Query({ schema: s.seedQuery }) q: { companyId: string; effectiveFrom: string }) { return this.masters.seedDefaults(t, q.companyId, q.effectiveFrom); }
  @RequirePermissions('payroll:read') @Get('rules')
  rules(@TenantId() t: string, @Query({ schema: s.rulesQuery }) q: { companyId: string; date: string; stateCode?: string | undefined }) { return this.masters.rulesOn(t, q.companyId, q.date, q.stateCode); }

  // runs
  @RequirePermissions('payroll:process') @Idempotent() @Post('runs') @ApiZodBody(s.createRunSchema)
  async createRun(@CurrentPrincipal() a: Principal, @Body({ schema: s.createRunSchema }) b: s.CreateRunInput) { return presentRun(await this.runs.create(a.tenantId, a.userId, b)); }
  @RequirePermissions('payroll:read') @Get('runs')
  async listRuns(@TenantId() t: string, @Query({ schema: s.listRunsQuery }) q: z.infer<typeof s.listRunsQuery>) { const p = await this.runs.list(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('payroll:read') @Get('runs/:id')
  async getRun(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return presentRun(await this.runs.get(t, i)); }
  @RequirePermissions('payroll:process') @Idempotent() @Post('runs/:id/pay') @HttpCode(200) @ApiZodBody(s.payRunSchema)
  async payRun(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.payRunSchema }) b: { date: string; paidFromAccountId: string }) { return presentRun(await this.runs.pay(a.tenantId, a.userId, i, b)); }
  @RequirePermissions('payroll:cancel') @Idempotent() @Post('runs/:id/cancel') @HttpCode(200) @ApiZodBody(s.cancelRunSchema)
  async cancelRun(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: s.cancelRunSchema }) b: { date: string; reason: string }) { return presentRun(await this.runs.cancel(a.tenantId, a.userId, i, b)); }

  // statutory remittances
  @RequirePermissions('payroll:process') @Idempotent() @Post('remittances') @ApiZodBody(s.remitSchema)
  async remit(@CurrentPrincipal() a: Principal, @Body({ schema: s.remitSchema }) b: s.RemitInput) { return strip(await this.runs.remit(a.tenantId, a.userId, b)); }
  @RequirePermissions('payroll:read') @Get('liabilities')
  liabilities(@TenantId() t: string, @Query({ schema: s.liabilitiesQuery }) q: { companyId: string }) { return this.runs.liabilities(t, q.companyId); }
}

@Module({ imports: [AccountingModule], controllers: [PayrollController], providers: [Recorder, PayrollMastersService, PayrollRunsService], exports: [PayrollMastersService, PayrollRunsService] })
export class PayrollModule {}
