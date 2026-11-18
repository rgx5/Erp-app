import { Body, Controller, Get, Headers, HttpCode, Inject, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { preconditionRequired } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import * as e from './expenses.schemas.js';
import { ExpensesService } from './expenses.service.js';

const id = z.uuid();
const strip = <T extends object>(row: T): Omit<T, 'tenantId'> => { const { tenantId: _t, ...rest } = row as T & { tenantId?: string }; return rest as Omit<T, 'tenantId'>; };
const versionOf = (h: string | undefined): number => { if (!h) throw preconditionRequired('Send the version you read in the If-Match header'); const n = Number(h.replaceAll('"', '')); if (!Number.isInteger(n) || n < 1) throw preconditionRequired('If-Match must be the integer version you read'); return n; };

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('v1/expenses')
export class ExpensesController {
  constructor(@Inject(ExpensesService) private readonly expenses: ExpensesService) {}

  @RequirePermissions('expenses:manage') @Idempotent() @Post('categories') @ApiZodBody(e.createExpenseCategorySchema)
  async createCategory(@TenantId() t: string, @Body({ schema: e.createExpenseCategorySchema }) b: e.CreateExpenseCategoryInput) { return strip(await this.expenses.createCategory(t, b)); }
  @RequirePermissions('expenses:read') @Get('categories')
  async categories(@TenantId() t: string, @Query({ schema: e.listExpenseCategoriesQuery }) q: { companyId: string; status?: 'active' | 'inactive' }) { return { items: (await this.expenses.listCategories(t, q.companyId, q.status)).map(strip) }; }
  @RequirePermissions('expenses:manage') @Patch('categories/:id') @ApiZodBody(e.updateExpenseCategorySchema)
  async updateCategory(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: e.updateExpenseCategorySchema }) b: e.UpdateExpenseCategoryInput) { return strip(await this.expenses.updateCategory(t, i, versionOf(m), b)); }

  @RequirePermissions('expenses:post') @Idempotent() @Post('vouchers') @ApiZodBody(e.createExpenseSchema)
  async create(@CurrentPrincipal() a: Principal, @Body({ schema: e.createExpenseSchema }) b: e.CreateExpenseInput) { return strip(await this.expenses.create(a.tenantId, a.userId, b)); }
  @RequirePermissions('expenses:read') @Get('vouchers')
  async list(@TenantId() t: string, @Query({ schema: e.listExpensesQuery }) q: z.infer<typeof e.listExpensesQuery>) { const p = await this.expenses.list(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('expenses:read') @Get('vouchers/:id')
  async get(@TenantId() t: string, @Param('id', { schema: id }) i: string) { return strip(await this.expenses.get(t, i)); }
  @RequirePermissions('expenses:cancel') @Idempotent() @Post('vouchers/:id/cancel') @HttpCode(200) @ApiZodBody(e.cancelExpenseSchema)
  async cancel(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: e.cancelExpenseSchema }) b: { date: string; reason: string }) { return strip(await this.expenses.cancel(a.tenantId, a.userId, i, b)); }
}

@Module({ imports: [AccountingModule], controllers: [ExpensesController], providers: [Recorder, ExpensesService], exports: [ExpensesService] })
export class RetailModule {}
