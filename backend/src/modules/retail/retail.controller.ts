import { Body, Controller, Get, Headers, HttpCode, Inject, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { preconditionRequired } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { CurrentPrincipal, type Principal, RequirePermissions, TenantId } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { SalesModule } from '../sales/sales.controller.js';
import * as e from './expenses.schemas.js';
import * as w from './wallet.schemas.js';
import { WalletService } from './wallet.service.js';
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

@ApiTags('retail')
@ApiBearerAuth()
@Controller('v1/retail')
export class RetailController {
  constructor(@Inject(WalletService) private readonly wallet: WalletService) {}

  @RequirePermissions('retail:read') @Get('settings')
  async settings(@TenantId() t: string, @Query({ schema: w.companyQuery }) q: { companyId: string }) { return strip(await this.wallet.getSettings(t, q.companyId) as never); }
  @RequirePermissions('retail:manage') @Put('settings') @ApiZodBody(w.retailSettingsSchema)
  async putSettings(@TenantId() t: string, @Query({ schema: w.companyQuery }) q: { companyId: string }, @Body({ schema: w.retailSettingsSchema }) b: { loyaltyPointsPerHundred?: string; loyaltyRupeesPerPoint?: string }) { return strip(await this.wallet.putSettings(t, q.companyId, b)); }

  /** A customer's store credit (unapplied credit in receivables), points and recent points history. */
  @RequirePermissions('retail:read') @Get('customers/:id/wallet')
  customerWallet(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Query({ schema: w.walletQuery }) q: { companyId: string }) { return this.wallet.wallet(t, q.companyId, i); }
  @RequirePermissions('retail:manage') @Post('loyalty/adjust') @HttpCode(200) @ApiZodBody(w.adjustPointsSchema)
  adjust(@CurrentPrincipal() a: Principal, @Body({ schema: w.adjustPointsSchema }) b: { companyId: string; customerId: string; points: string; note: string }) { return this.wallet.adjustPoints(a.tenantId, a.userId, b); }

  @RequirePermissions('retail:manage') @Idempotent() @Post('coupons') @ApiZodBody(w.createCouponSchema)
  async createCoupon(@TenantId() t: string, @Body({ schema: w.createCouponSchema }) b: w.CreateCouponInput) { return strip(await this.wallet.createCoupon(t, b)); }
  @RequirePermissions('retail:read') @Get('coupons')
  async coupons(@TenantId() t: string, @Query({ schema: w.listCouponsQuery }) q: z.infer<typeof w.listCouponsQuery>) { const p = await this.wallet.listCoupons(t, q); return { items: p.items.map(strip), nextCursor: p.nextCursor }; }
  @RequirePermissions('retail:manage') @Patch('coupons/:id') @ApiZodBody(w.updateCouponSchema)
  async updateCoupon(@TenantId() t: string, @Param('id', { schema: id }) i: string, @Headers('if-match') m: string | undefined, @Body({ schema: w.updateCouponSchema }) b: Record<string, unknown>) { return strip(await this.wallet.updateCoupon(t, i, versionOf(m), b)); }
  /** Can this coupon be used on a bill of this size today, and what does it take off? Nothing is used up. */
  @RequirePermissions('pos:sell') @Post('coupons/validate') @HttpCode(200) @ApiZodBody(w.validateCouponSchema)
  validate(@TenantId() t: string, @Body({ schema: w.validateCouponSchema }) b: { companyId: string; code: string; billTotal: string; date?: string }) { return this.wallet.validateCoupon(t, b); }
}

@Module({ imports: [AccountingModule, SalesModule], controllers: [ExpensesController, RetailController], providers: [Recorder, ExpensesService, WalletService], exports: [ExpensesService, WalletService] })
export class RetailModule {}
