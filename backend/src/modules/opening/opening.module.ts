import { Body, Controller, Inject, Injectable, Module, Post, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { AccountingModule } from '../accounting/accounting.controller.js';
import { PostingService } from '../accounting/posting.service.js';
import { RequiresModule } from '../identity/entitlements.js';
import { CurrentPrincipal, type Principal, RequirePermissions } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { PurchasingModule } from '../purchasing/purchasing.controller.js';
import { PurchasingSettingsService } from '../purchasing/purchasing-settings.service.js';
import { SalesModule } from '../sales/sales.controller.js';
import { SalesSettingsService } from '../sales/sales-settings.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const amount = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'An amount such as 1500 or 1500.50').refine((v) => Number(v) > 0, 'Must be more than zero');
export const openingBalancesSchema = z.strictObject({
  companyId: z.uuid(), asOf: isoDate,
  items: z.array(z.strictObject({ partyId: z.uuid(), amount })).min(1).max(100),
});
export type OpeningBalancesInput = z.infer<typeof openingBalancesSchema>;
export interface OpeningResult { partyId: string; status: 'created' | 'exists'; documentId: string; number: string }

type PartyRow = { id: string; code: string; legal_name: string; trade_name: string | null; gstin: string | null; gst_treatment: string; is_customer: boolean; is_supplier: boolean; status: string };

/**
 * Brings forward what customers owe and what is owed to suppliers when a business starts here part-way through its life. Each balance is one
 * document with no lines (an opening invoice, or an opening bill) posted against the opening-balance equity account, so receipts, payments,
 * ageing and statements treat it like any other, while sales, purchases and GST do not count it. Recording the same party twice is a no-op.
 */
@Injectable()
export class OpeningBalancesService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(SalesSettingsService) private readonly salesSettings: SalesSettingsService,
    @Inject(PurchasingSettingsService) private readonly purchasingSettings: PurchasingSettingsService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  private async context(tx: Tx, tenantId: string, companyId: string): Promise<{ registrationId: string; state: string; equityAccountId: string }> {
    const reg = (await tx.execute<{ id: string; gstin: string }>(sql`SELECT id, gstin FROM erp.gst_registrations WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND status = 'active' ORDER BY effective_from, id LIMIT 1`)).rows[0];
    if (!reg) throw new AppError(422, 'no_gst_registration', 'The business needs a GST registration before opening balances can be recorded. Add one under Settings, Companies.');
    const eq = (await tx.execute<{ id: string | null }>(sql`SELECT opening_balance_account_id AS id FROM erp.company_stock_settings WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid`)).rows[0]?.id;
    if (!eq) throw new AppError(422, 'no_opening_account', 'Choose the opening-balance account under Inventory settings (the standard set-up does this) before recording opening balances.');
    return { registrationId: reg.id, state: reg.gstin.slice(0, 2), equityAccountId: eq };
  }

  private async partiesOf(tx: Tx, tenantId: string, ids: string[]): Promise<Map<string, PartyRow>> {
    const rows = (await tx.execute<PartyRow>(sql`SELECT id, code, legal_name, trade_name, gstin, gst_treatment, is_customer, is_supplier, status FROM erp.parties WHERE tenant_id = ${tenantId}::uuid AND id = ANY (${sql.raw(`ARRAY[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]`)})`)).rows;
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** What customers owe: one opening invoice each. */
  receivable(tenantId: string, actorId: string, input: OpeningBalancesInput): Promise<OpeningResult[]> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const ctx = await this.context(tx, tenantId, input.companyId);
      const settings = await this.salesSettings.require(tx, tenantId, input.companyId, ['receivableAccountId']);
      const parties = await this.partiesOf(tx, tenantId, input.items.map((i) => i.partyId));
      const out: OpeningResult[] = [];
      for (const item of input.items) {
        const p = parties.get(item.partyId);
        if (!p) throw new AppError(404, 'not_found', 'A customer was not found');
        if (!p.is_customer) throw validationFailed([{ path: 'items', message: `${p.legal_name} is not a customer` }]);
        const prior = (await tx.execute<{ id: string; status: string }>(sql`SELECT id, status FROM erp.sales_invoices WHERE tenant_id = ${tenantId}::uuid AND company_id = ${input.companyId}::uuid AND customer_id = ${p.id}::uuid AND document_type = 'opening_balance'`)).rows;
        const existing = prior.find((r) => r.status === 'posted');
        // a number is never reused: entering a balance again after cancelling one takes the next number
        const number = `OPEN-${p.code}${prior.length ? `-${prior.length + 1}` : ''}`.slice(0, 40);
        if (existing) { out.push({ partyId: p.id, status: 'exists', documentId: existing.id, number }); continue; }
        const id = uuidv7();
        const { entry } = await this.posting.post(tx, tenantId, {
          companyId: input.companyId, postingDate: input.asOf, journalType: 'opening', description: `Opening balance: ${p.trade_name ?? p.legal_name}`, postedBy: actorId, source: { type: 'sales_invoice', id, event: 'post' },
          lines: [{ accountId: settings.receivableAccountId as string, debit: item.amount, partyId: p.id }, { accountId: ctx.equityAccountId, credit: item.amount }],
        });
        await tx.execute(sql`INSERT INTO erp.sales_invoices (tenant_id, id, company_id, gst_registration_id, document_type, invoice_no, invoice_date, due_date, customer_id, customer_name, customer_gstin, customer_gst_treatment, place_of_supply, supply_type, tax_regime, taxable_total, grand_total, journal_entry_id, status, posted_by)
          VALUES (${tenantId}::uuid, ${id}::uuid, ${input.companyId}::uuid, ${ctx.registrationId}::uuid, 'opening_balance', ${number}, ${input.asOf}::date, ${input.asOf}::date, ${p.id}::uuid, ${p.trade_name ?? p.legal_name}, ${p.gstin}, ${p.gst_treatment}, ${ctx.state}, 'b2c', 'intra', ${item.amount}::numeric, ${item.amount}::numeric, ${entry.id}::uuid, 'posted', ${actorId}::uuid)`);
        await this.recorder.record(tx, tenantId, 'opening_balance', 'recorded', { id }, { side: 'receivable', partyId: p.id, amount: item.amount, asOf: input.asOf });
        out.push({ partyId: p.id, status: 'created', documentId: id, number });
      }
      return out;
    });
  }

  /** What is owed to suppliers: one opening bill each. */
  payable(tenantId: string, actorId: string, input: OpeningBalancesInput): Promise<OpeningResult[]> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const ctx = await this.context(tx, tenantId, input.companyId);
      const settings = await this.purchasingSettings.get(tenantId, input.companyId);
      if (!settings?.payableAccountId) throw new AppError(422, 'no_payable_account', 'Choose the payables account under Purchasing settings (the standard set-up does this) before recording opening balances.');
      const parties = await this.partiesOf(tx, tenantId, input.items.map((i) => i.partyId));
      const out: OpeningResult[] = [];
      for (const item of input.items) {
        const p = parties.get(item.partyId);
        if (!p) throw new AppError(404, 'not_found', 'A supplier was not found');
        if (!p.is_supplier) throw validationFailed([{ path: 'items', message: `${p.legal_name} is not a supplier` }]);
        const prior = (await tx.execute<{ id: string; status: string }>(sql`SELECT id, status FROM erp.supplier_bills WHERE tenant_id = ${tenantId}::uuid AND company_id = ${input.companyId}::uuid AND supplier_id = ${p.id}::uuid AND document_type = 'opening_balance'`)).rows;
        const existing = prior.find((r) => r.status === 'posted');
        const number = `OPEN-${p.code}${prior.length ? `-${prior.length + 1}` : ''}`.slice(0, 40);
        if (existing) { out.push({ partyId: p.id, status: 'exists', documentId: existing.id, number }); continue; }
        const id = uuidv7();
        const { entry } = await this.posting.post(tx, tenantId, {
          companyId: input.companyId, postingDate: input.asOf, journalType: 'opening', description: `Opening balance: ${p.trade_name ?? p.legal_name}`, postedBy: actorId, source: { type: 'supplier_bill', id, event: 'post' },
          lines: [{ accountId: ctx.equityAccountId, debit: item.amount }, { accountId: settings.payableAccountId, credit: item.amount, partyId: p.id }],
        });
        await tx.execute(sql`INSERT INTO erp.supplier_bills (tenant_id, id, company_id, document_type, bill_no, supplier_invoice_no, supplier_invoice_date, bill_date, due_date, gst_registration_id, supplier_id, supplier_name, supplier_gstin, supplier_gst_treatment, supplier_state, place_of_supply, tax_regime, taxable_total, grand_total, match_status, journal_entry_id, status, posted_by)
          VALUES (${tenantId}::uuid, ${id}::uuid, ${input.companyId}::uuid, 'opening_balance', ${number}, 'OPENING', ${input.asOf}::date, ${input.asOf}::date, ${input.asOf}::date, ${ctx.registrationId}::uuid, ${p.id}::uuid, ${p.trade_name ?? p.legal_name}, ${p.gstin}, ${p.gst_treatment}, ${p.gstin ? p.gstin.slice(0, 2) : ctx.state}, ${ctx.state}, 'intra', ${item.amount}::numeric, ${item.amount}::numeric, 'not_applicable', ${entry.id}::uuid, 'posted', ${actorId}::uuid)`);
        await this.recorder.record(tx, tenantId, 'opening_balance', 'recorded', { id }, { side: 'payable', partyId: p.id, amount: item.amount, asOf: input.asOf });
        out.push({ partyId: p.id, status: 'created', documentId: id, number });
      }
      return out;
    });
  }
}

@ApiTags('opening-balances')
@ApiBearerAuth()
@Controller('v1')
export class OpeningBalancesController {
  constructor(@Inject(OpeningBalancesService) private readonly svc: OpeningBalancesService) {}

  /** Brings forward what customers owe (one opening invoice each). Recording a customer twice changes nothing. */
  @RequiresModule('sales') @RequirePermissions('receivables:post') @Idempotent() @HttpCode(200) @Post('receivables/opening-balances') @ApiZodBody(openingBalancesSchema)
  async receivable(@CurrentPrincipal() a: Principal, @Body({ schema: openingBalancesSchema }) b: OpeningBalancesInput) { return { items: await this.svc.receivable(a.tenantId, a.userId, b) }; }

  /** Brings forward what is owed to suppliers (one opening bill each). */
  @RequiresModule('purchasing') @RequirePermissions('payables:post') @Idempotent() @HttpCode(200) @Post('payables/opening-balances') @ApiZodBody(openingBalancesSchema)
  async payable(@CurrentPrincipal() a: Principal, @Body({ schema: openingBalancesSchema }) b: OpeningBalancesInput) { return { items: await this.svc.payable(a.tenantId, a.userId, b) }; }
}

@Module({ imports: [AccountingModule, SalesModule, PurchasingModule], controllers: [OpeningBalancesController], providers: [Recorder, OpeningBalancesService] })
export class OpeningBalancesModule {}
