import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { ensureAccount } from '../accounting/ensure-account.js';
import { PostingService } from '../accounting/posting.service.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { RequiresModule } from '../identity/entitlements.js';
import { CurrentPrincipal, type Principal, RequirePermissions } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { seedTcsSections } from '../sales/tcs.seed.js';

const id = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.string().regex(/^\d{1,14}(\.\d{1,2})?$/, 'An amount such as 2500 or 2500.50').refine((v) => Number(v) > 0, 'Must be more than zero');
export const createSectionSchema = z.strictObject({ code: z.string().trim().min(1).max(60), description: z.string().trim().min(1).max(200), rate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'A percentage such as 1 or 2.5') });
export const updateSectionSchema = z.strictObject({ description: z.string().trim().min(1).max(200).optional(), rate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/).optional(), status: z.enum(['active', 'inactive']).optional() });
export const registerQuery = z.object({ companyId: id, from: isoDate, to: isoDate });
export const depositSchema = z.strictObject({ companyId: id, periodFrom: isoDate, periodTo: isoDate, amount: money, depositedOn: isoDate, challanNo: z.string().trim().max(60).optional(), bankAccountId: id, notes: z.string().trim().max(300).optional() });
export const depositsQuery = z.object({ companyId: id });

/**
 * Tax collected at source by the seller. It is collected from the customer on top of the invoice (so the customer owes it with the bill), held
 * in "TCS payable" and paid to the government; a deposit moves it out of that account into the bank.
 */
@Injectable()
export class TcsService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(PostingService) private readonly posting: PostingService, @Inject(Recorder) private readonly recorder: Recorder) {}

  sections(tenantId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await seedTcsSections(tx, tenantId);
      const rows = (await tx.execute<{ id: string; code: string; description: string; rate: string; status: string }>(sql`SELECT id, code, description, rate::text, status FROM erp.tcs_sections WHERE tenant_id = ${tenantId}::uuid ORDER BY code`)).rows;
      return { items: rows };
    });
  }
  createSection(tenantId: string, input: z.infer<typeof createSectionSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      await seedTcsSections(tx, tenantId);
      const dup = (await tx.execute(sql`SELECT 1 FROM erp.tcs_sections WHERE tenant_id = ${tenantId}::uuid AND code = ${input.code}`)).rows[0];
      if (dup) throw new AppError(409, 'duplicate', `Section ${input.code} already exists`);
      const row = (await tx.execute<{ id: string; code: string; description: string; rate: string; status: string }>(sql`INSERT INTO erp.tcs_sections (tenant_id, id, code, description, rate) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${input.code}, ${input.description}, ${input.rate}::numeric) RETURNING id, code, description, rate::text, status`)).rows[0];
      return row;
    });
  }
  updateSection(tenantId: string, sectionId: string, input: z.infer<typeof updateSectionSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const row = (await tx.execute<{ id: string; code: string; description: string; rate: string; status: string }>(sql`UPDATE erp.tcs_sections SET description = COALESCE(${input.description ?? null}, description), rate = COALESCE(${input.rate ?? null}::numeric, rate), status = COALESCE(${input.status ?? null}, status)
        WHERE tenant_id = ${tenantId}::uuid AND id = ${sectionId}::uuid RETURNING id, code, description, rate::text, status`)).rows[0];
      if (!row) throw new AppError(404, 'not_found', 'Section was not found');
      return row;
    });
  }

  /** Invoices that carried TCS in the period, what was collected, what has been deposited, and what is still to pay. Customers without a PAN are flagged: the higher rate may apply to them. */
  register(tenantId: string, q: z.infer<typeof registerQuery>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const items = (await tx.execute<{ id: string; invoice_no: string; invoice_date: string; customer_name: string; pan: string | null; tcs_section: string; tcs_rate: string; tcs_base: string; tcs_amount: string; status: string }>(sql`
        SELECT i.id, i.invoice_no, i.invoice_date::text, i.customer_name, p.pan, i.tcs_section, i.tcs_rate::text, i.tcs_base::text, i.tcs_amount::text, i.status
          FROM erp.sales_invoices i LEFT JOIN erp.parties p ON p.tenant_id = i.tenant_id AND p.id = i.customer_id
         WHERE i.tenant_id = ${tenantId}::uuid AND i.company_id = ${q.companyId}::uuid AND i.tcs_amount > 0 AND i.invoice_date BETWEEN ${q.from}::date AND ${q.to}::date
         ORDER BY i.invoice_date, i.invoice_no`)).rows;
      const live = items.filter((r) => r.status === 'posted');
      const collected = (await tx.execute<{ s: string }>(sql`SELECT COALESCE(sum(i.tcs_amount), 0)::numeric(18,4)::text AS s FROM erp.sales_invoices i WHERE i.tenant_id = ${tenantId}::uuid AND i.company_id = ${q.companyId}::uuid AND i.status = 'posted' AND i.tcs_amount > 0 AND i.invoice_date BETWEEN ${q.from}::date AND ${q.to}::date`)).rows[0]?.s ?? '0.0000';
      const deposited = (await tx.execute<{ s: string }>(sql`SELECT COALESCE(sum(amount), 0)::numeric(18,4)::text AS s FROM erp.tcs_deposits WHERE tenant_id = ${tenantId}::uuid AND company_id = ${q.companyId}::uuid AND period_from >= ${q.from}::date AND period_to <= ${q.to}::date`)).rows[0]?.s ?? '0.0000';
      const pending = (await tx.execute<{ s: string }>(sql`SELECT (${collected}::numeric - ${deposited}::numeric)::numeric(18,4)::text AS s`)).rows[0]?.s ?? '0.0000';
      return {
        items: items.map((r) => ({ id: r.id, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, customerName: r.customer_name, pan: r.pan, section: r.tcs_section, rate: r.tcs_rate, base: r.tcs_base, amount: r.tcs_amount, status: r.status, panMissing: !r.pan })),
        totals: { collected, deposited, pending, invoices: live.length, withoutPan: live.filter((r) => !r.pan).length },
      };
    }, { readOnly: true });
  }

  deposits(tenantId: string, q: z.infer<typeof depositsQuery>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = (await tx.execute<{ id: string; period_from: string; period_to: string; amount: string; deposited_on: string; challan_no: string | null; notes: string | null }>(sql`SELECT id, period_from::text, period_to::text, amount::text, deposited_on::text, challan_no, notes FROM erp.tcs_deposits WHERE tenant_id = ${tenantId}::uuid AND company_id = ${q.companyId}::uuid ORDER BY deposited_on DESC LIMIT 200`)).rows;
      return { items: rows.map((r) => ({ id: r.id, periodFrom: r.period_from, periodTo: r.period_to, amount: r.amount, depositedOn: r.deposited_on, challanNo: r.challan_no, notes: r.notes })) };
    }, { readOnly: true });
  }

  /** Paying the collected tax to the government: Dr TCS payable, Cr bank. */
  deposit(tenantId: string, actorId: string, input: z.infer<typeof depositSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      if (input.periodTo < input.periodFrom) throw validationFailed([{ path: 'periodTo', message: 'The period ends before it starts' }]);
      const bank = (await tx.execute<{ type: string; is_group: boolean; status: string }>(sql`SELECT type, is_group, status FROM erp.accounts WHERE tenant_id = ${tenantId}::uuid AND company_id = ${input.companyId}::uuid AND id = ${input.bankAccountId}::uuid`)).rows[0];
      if (!bank || bank.type !== 'asset' || bank.is_group || bank.status !== 'active') throw validationFailed([{ path: 'bankAccountId', message: 'Choose an active bank or cash account' }]);
      const payable = await ensureAccount(tx, tenantId, input.companyId, { code: '2250', name: 'TCS payable', type: 'liability', parentCode: '2200' });
      const depositId = uuidv7();
      const e = await this.posting.post(tx, tenantId, {
        companyId: input.companyId, postingDate: input.depositedOn, journalType: 'system', description: `TCS deposited${input.challanNo ? ` · challan ${input.challanNo}` : ''} for ${input.periodFrom} to ${input.periodTo}`,
        source: { type: 'tcs_deposit', id: depositId, event: 'deposit' }, postedBy: actorId, lines: [{ accountId: payable, debit: input.amount }, { accountId: input.bankAccountId, credit: input.amount }],
      });
      await tx.execute(sql`INSERT INTO erp.tcs_deposits (tenant_id, id, company_id, period_from, period_to, amount, deposited_on, challan_no, account_id, entry_id, notes, created_by)
        VALUES (${tenantId}::uuid, ${depositId}::uuid, ${input.companyId}::uuid, ${input.periodFrom}::date, ${input.periodTo}::date, ${input.amount}::numeric, ${input.depositedOn}::date, ${input.challanNo ?? null}, ${input.bankAccountId}::uuid, ${e.entry.id}::uuid, ${input.notes ?? null}, ${actorId}::uuid)`);
      await this.recorder.record(tx, tenantId, 'tcs_deposit', 'created', { id: depositId }, { amount: input.amount, challanNo: input.challanNo ?? null });
      return { id: depositId, amount: input.amount, depositedOn: input.depositedOn, challanNo: input.challanNo ?? null };
    });
  }
}

@ApiTags('tcs')
@ApiBearerAuth()
@RequiresModule('accounting')
@Controller('v1/tcs')
export class TcsController {
  constructor(@Inject(TcsService) private readonly svc: TcsService) {}
  @RequirePermissions('tcs:read') @Get('sections') sections(@CurrentPrincipal() a: Principal) { return this.svc.sections(a.tenantId); }
  @RequirePermissions('tcs:manage') @Idempotent() @Post('sections') @ApiZodBody(createSectionSchema) createSection(@CurrentPrincipal() a: Principal, @Body({ schema: createSectionSchema }) b: z.infer<typeof createSectionSchema>) { return this.svc.createSection(a.tenantId, b); }
  @RequirePermissions('tcs:manage') @Patch('sections/:id') @ApiZodBody(updateSectionSchema) updateSection(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: updateSectionSchema }) b: z.infer<typeof updateSectionSchema>) { return this.svc.updateSection(a.tenantId, i, b); }
  @RequirePermissions('tcs:read') @Get('register') register(@CurrentPrincipal() a: Principal, @Query({ schema: registerQuery }) q: z.infer<typeof registerQuery>) { return this.svc.register(a.tenantId, q); }
  @RequirePermissions('tcs:read') @Get('deposits') deposits(@CurrentPrincipal() a: Principal, @Query({ schema: depositsQuery }) q: z.infer<typeof depositsQuery>) { return this.svc.deposits(a.tenantId, q); }
  @RequirePermissions('tcs:manage') @Idempotent() @HttpCode(201) @Post('deposits') @ApiZodBody(depositSchema) deposit(@CurrentPrincipal() a: Principal, @Body({ schema: depositSchema }) b: z.infer<typeof depositSchema>) { return this.svc.deposit(a.tenantId, a.userId, b); }
}

@Module({ imports: [AccountingModule], controllers: [TcsController], providers: [Recorder, TcsService] })
export class TcsModule {}
