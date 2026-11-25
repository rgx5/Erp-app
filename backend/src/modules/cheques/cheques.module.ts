import { Body, Controller, HttpCode, Inject, Injectable, Module, Param, Post, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { ApiZodBody } from '../../platform/http/validation.js';
import { Idempotent } from '../../platform/services/idempotency.js';
import { RequiresModule } from '../identity/entitlements.js';
import { CurrentPrincipal, type Principal, RequirePermissions } from '../identity/principal.js';
import { Recorder } from '../masterdata/helpers.js';
import { PayablesService } from '../purchasing/payables.service.js';
import { PurchasingModule } from '../purchasing/purchasing.controller.js';
import { ReceivablesService } from '../sales/receivables.service.js';
import { SalesModule } from '../sales/sales.controller.js';

const id = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'An amount such as 1500 or 1500.50').refine((v) => Number(v) > 0, 'Must be more than zero');
const allocation = z.strictObject({ invoiceId: id.optional(), billId: id.optional(), amount: money });
export const createChequeSchema = z.strictObject({
  companyId: id, partyId: id, chequeNo: z.string().trim().min(1).max(30), chequeDate: isoDate, bankName: z.string().trim().max(100).optional(), amount: money,
  /** Invoices (or bills) this cheque will settle when it clears. */
  allocations: z.array(allocation).max(200).default([]), notes: z.string().trim().max(500).optional(),
});
export const listChequesQuery = z.object({ companyId: id, status: z.enum(['pending', 'deposited', 'cleared', 'bounced', 'cancelled', 'open']).optional(), partyId: id.optional(), dueBy: isoDate.optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
export const depositSchema = z.strictObject({ date: isoDate, accountId: id });
export const clearSchema = z.strictObject({ date: isoDate, accountId: id.optional() });
export const bounceSchema = z.strictObject({ date: isoDate, reason: z.string().trim().min(1).max(300) });
export const cancelChequeSchema = z.strictObject({ reason: z.string().trim().min(1).max(300) });
type Dir = 'received' | 'issued';

type Row = { id: string; company_id: string; direction: Dir; party_id: string; party_name: string; cheque_no: string; cheque_date: string; bank_name: string | null; amount: string; status: string; account_id: string | null; allocations: { invoiceId?: string; billId?: string; amount: string }[]; notes: string | null; deposited_on: string | null; cleared_on: string | null; bounced_on: string | null; bounce_reason: string | null; receipt_id: string | null; payment_id: string | null };
const present = (r: Row) => ({ id: r.id, companyId: r.company_id, direction: r.direction, partyId: r.party_id, partyName: r.party_name, chequeNo: r.cheque_no, chequeDate: r.cheque_date, bankName: r.bank_name, amount: r.amount, status: r.status, accountId: r.account_id, allocations: r.allocations, notes: r.notes, depositedOn: r.deposited_on, clearedOn: r.cleared_on, bouncedOn: r.bounced_on, bounceReason: r.bounce_reason, receiptId: r.receipt_id, paymentId: r.payment_id });
const SELECT = sql`SELECT c.id, c.company_id, c.direction, c.party_id, COALESCE(p.trade_name, p.legal_name) AS party_name, c.cheque_no, c.cheque_date::text, c.bank_name, c.amount::text, c.status, c.account_id, c.allocations, c.notes, c.deposited_on::text, c.cleared_on::text, c.bounced_on::text, c.bounce_reason, c.receipt_id, c.payment_id
  FROM erp.cheques c JOIN erp.parties p ON p.tenant_id = c.tenant_id AND p.id = c.party_id`;

/**
 * The cheque register. A cheque is held, deposited (or issued), and then clears or bounces. Money enters the books only when it clears, through
 * the ordinary receipt or supplier payment (so allocations, ageing and bank reconciliation all work as usual); a bounce after clearing cancels that.
 */
@Injectable()
export class ChequesService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
    @Inject(ReceivablesService) private readonly receivables: ReceivablesService,
    @Inject(PayablesService) private readonly payables: PayablesService,
  ) {}

  list(tenantId: string, direction: Dir, q: z.infer<typeof listChequesQuery>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const status = q.status === 'open' ? sql`AND c.status IN ('pending', 'deposited')` : q.status ? sql`AND c.status = ${q.status}` : sql``;
      const rows = (await tx.execute<Row>(sql`${SELECT} WHERE c.tenant_id = ${tenantId}::uuid AND c.company_id = ${q.companyId}::uuid AND c.direction = ${direction} ${status}
        ${q.partyId ? sql`AND c.party_id = ${q.partyId}::uuid` : sql``} ${q.dueBy ? sql`AND c.cheque_date <= ${q.dueBy}::date` : sql``} ORDER BY c.cheque_date, c.cheque_no LIMIT ${q.limit}`)).rows;
      return { items: rows.map(present) };
    }, { readOnly: true });
  }

  create(tenantId: string, actorId: string, direction: Dir, input: z.infer<typeof createChequeSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const party = (await tx.execute<{ id: string; is_customer: boolean; is_supplier: boolean; legal_name: string }>(sql`SELECT id, is_customer, is_supplier, legal_name FROM erp.parties WHERE tenant_id = ${tenantId}::uuid AND id = ${input.partyId}::uuid`)).rows[0];
      if (!party) throw new AppError(404, 'not_found', 'Party was not found');
      if (direction === 'received' && !party.is_customer) throw validationFailed([{ path: 'partyId', message: `${party.legal_name} is not a customer` }]);
      if (direction === 'issued' && !party.is_supplier) throw validationFailed([{ path: 'partyId', message: `${party.legal_name} is not a supplier` }]);
      const sum = input.allocations.reduce((t, a) => t + Math.round(Number(a.amount) * 10_000), 0);
      if (sum > Math.round(Number(input.amount) * 10_000)) throw validationFailed([{ path: 'allocations', message: 'More is allocated than the cheque is for' }]);
      for (const a of input.allocations) if ((direction === 'received' ? a.invoiceId : a.billId) === undefined) throw validationFailed([{ path: 'allocations', message: direction === 'received' ? 'Each allocation names an invoice' : 'Each allocation names a bill' }]);
      const cid = uuidv7();
      try {
        await tx.execute(sql`INSERT INTO erp.cheques (tenant_id, id, company_id, direction, party_id, cheque_no, cheque_date, bank_name, amount, status, allocations, notes, created_by)
          VALUES (${tenantId}::uuid, ${cid}::uuid, ${input.companyId}::uuid, ${direction}, ${input.partyId}::uuid, ${input.chequeNo}, ${input.chequeDate}::date, ${input.bankName ?? null}, ${input.amount}::numeric, ${direction === 'issued' ? 'pending' : 'pending'}, ${JSON.stringify(input.allocations)}::jsonb, ${input.notes ?? null}, ${actorId}::uuid)`);
      } catch (e) { if (/cheques_no/.test(String(e)) || /duplicate key/.test(String(e))) throw new AppError(409, 'duplicate_cheque', `Cheque ${input.chequeNo} is already recorded for this party`); throw e; }
      await this.recorder.record(tx, tenantId, 'cheque', 'recorded', { id: cid }, { direction, partyId: input.partyId, chequeNo: input.chequeNo, amount: input.amount });
      return this.one(tx, tenantId, cid);
    });
  }

  private async one(tx: Parameters<Parameters<UnitOfWork['inTenant']>[1]>[0], tenantId: string, id: string) {
    const r = (await tx.execute<Row>(sql`${SELECT} WHERE c.tenant_id = ${tenantId}::uuid AND c.id = ${id}::uuid`)).rows[0];
    if (!r) throw new AppError(404, 'not_found', 'Cheque was not found');
    return present(r);
  }
  private async lock(tx: Parameters<Parameters<UnitOfWork['inTenant']>[1]>[0], tenantId: string, direction: Dir, id: string) {
    const r = (await tx.execute<Row>(sql`${SELECT} WHERE c.tenant_id = ${tenantId}::uuid AND c.id = ${id}::uuid AND c.direction = ${direction} FOR UPDATE OF c`)).rows[0];
    if (!r) throw new AppError(404, 'not_found', 'Cheque was not found');
    return r;
  }

  /** A received cheque has gone to the bank (or an issued one has been handed over): the account it goes into or out of is fixed here. */
  deposit(tenantId: string, actorId: string, direction: Dir, id: string, input: z.infer<typeof depositSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const c = await this.lock(tx, tenantId, direction, id);
      if (c.status !== 'pending') throw new AppError(409, 'wrong_status', `This cheque is ${c.status}; only a pending cheque can be ${direction === 'received' ? 'deposited' : 'issued'}`);
      await tx.execute(sql`UPDATE erp.cheques SET status = 'deposited', deposited_on = ${input.date}::date, account_id = ${input.accountId}::uuid, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await this.recorder.record(tx, tenantId, 'cheque', 'deposited', { id }, { date: input.date, accountId: input.accountId });
      return this.one(tx, tenantId, id);
    });
  }

  /** The bank has paid: this is when the receipt (or supplier payment) is made. */
  async clear(tenantId: string, actorId: string, direction: Dir, id: string, input: z.infer<typeof clearSchema>) {
    // claim the cheque first, so two people clearing it at once cannot both make a receipt
    const claimed = await this.uow.inTenant(tenantId, async (tx) => {
      const c = await this.lock(tx, tenantId, direction, id);
      if (c.status !== 'pending' && c.status !== 'deposited') throw new AppError(409, 'wrong_status', `This cheque is ${c.status}`);
      const accountId = input.accountId ?? c.account_id;
      if (!accountId) throw validationFailed([{ path: 'accountId', message: 'Choose the bank or cash account the cheque went through' }]);
      await tx.execute(sql`UPDATE erp.cheques SET status = 'clearing', updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      return { c, accountId };
    });
    const { c, accountId } = claimed;
    let ref: { receipt?: string; payment?: string };
    try {
      if (direction === 'received') {
        const r = await this.receivables.createReceipt(tenantId, actorId, { companyId: c.company_id, customerId: c.party_id, receiptDate: input.date, amount: c.amount, method: 'cheque', depositAccountId: accountId, reference: `Cheque ${c.cheque_no}`, ...(c.allocations.length ? { allocations: c.allocations.map((a) => ({ invoiceId: a.invoiceId as string, amount: a.amount })) } : {}) });
        ref = { receipt: r.receipt.id };
      } else {
        const p = await this.payables.createPayment(tenantId, actorId, { companyId: c.company_id, supplierId: c.party_id, paymentDate: input.date, amount: c.amount, method: 'cheque', paidFromAccountId: accountId, reference: `Cheque ${c.cheque_no}`, ...(c.allocations.length ? { allocations: c.allocations.map((a) => ({ billId: a.billId as string, amount: a.amount })) } : {}) } as never) as { payment: { id: string } };
        ref = { payment: p.payment.id };
      }
    } catch (e) {
      await this.uow.inTenant(tenantId, async (tx) => { await tx.execute(sql`UPDATE erp.cheques SET status = ${c.status}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid AND status = 'clearing'`); });
      throw e;
    }
    return this.uow.inTenant(tenantId, async (tx) => {
      await tx.execute(sql`UPDATE erp.cheques SET status = 'cleared', cleared_on = ${input.date}::date, account_id = ${accountId}::uuid, receipt_id = ${ref.receipt ?? null}::uuid, payment_id = ${ref.payment ?? null}::uuid, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await this.recorder.record(tx, tenantId, 'cheque', 'cleared', { id }, { date: input.date, ...ref });
      return this.one(tx, tenantId, id);
    });
  }

  /** The bank returned it. If it had already cleared, the receipt or payment made for it is cancelled and what it settled is released. */
  async bounce(tenantId: string, actorId: string, direction: Dir, id: string, input: z.infer<typeof bounceSchema>) {
    {
      const c = await this.uow.inTenant(tenantId, async (tx) => this.lock(tx, tenantId, direction, id));
      if (c.status === 'bounced' || c.status === 'cancelled') throw new AppError(409, 'wrong_status', `This cheque is already ${c.status}`);
      if (c.status === 'cleared') {
        if (direction === 'received' && c.receipt_id) await this.receivables.cancelReceipt(tenantId, actorId, c.receipt_id, { cancelDate: input.date, reason: `Cheque ${c.cheque_no} bounced: ${input.reason}` });
        if (direction === 'issued' && c.payment_id) await this.payables.cancelPayment(tenantId, actorId, c.payment_id, { cancelDate: input.date, reason: `Cheque ${c.cheque_no} bounced: ${input.reason}` });
      }
      return this.uow.inTenant(tenantId, async (tx) => {
        await tx.execute(sql`UPDATE erp.cheques SET status = 'bounced', bounced_on = ${input.date}::date, bounce_reason = ${input.reason}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
        await this.recorder.record(tx, tenantId, 'cheque', 'bounced', { id }, { date: input.date, reason: input.reason });
        return this.one(tx, tenantId, id);
      });
    }
  }

  cancel(tenantId: string, actorId: string, direction: Dir, id: string, input: z.infer<typeof cancelChequeSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const c = await this.lock(tx, tenantId, direction, id);
      if (c.status !== 'pending' && c.status !== 'deposited') throw new AppError(409, 'wrong_status', `A ${c.status} cheque cannot be cancelled here${c.status === 'cleared' ? ' (mark it bounced instead)' : ''}`);
      await tx.execute(sql`UPDATE erp.cheques SET status = 'cancelled', notes = COALESCE(notes || ' · ', '') || ${`Cancelled: ${input.reason}`}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid`);
      await this.recorder.record(tx, tenantId, 'cheque', 'cancelled', { id }, { reason: input.reason });
      return this.one(tx, tenantId, id);
    });
  }
}

@ApiTags('cheques')
@ApiBearerAuth()
@RequiresModule('sales')
@Controller('v1/cheques/received')
export class ReceivedChequesController {
  constructor(@Inject(ChequesService) private readonly svc: ChequesService) {}
  @RequirePermissions('cheques:read') @Get() list(@CurrentPrincipal() a: Principal, @Query({ schema: listChequesQuery }) q: z.infer<typeof listChequesQuery>) { return this.svc.list(a.tenantId, 'received', q); }
  /** Records a cheque received from a customer. */
  @RequirePermissions('cheques:post') @Idempotent() @Post() @ApiZodBody(createChequeSchema) create(@CurrentPrincipal() a: Principal, @Body({ schema: createChequeSchema }) b: z.infer<typeof createChequeSchema>) { return this.svc.create(a.tenantId, a.userId, 'received', b); }
  @RequirePermissions('cheques:post') @HttpCode(200) @Post(':id/deposit') @ApiZodBody(depositSchema) deposit(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: depositSchema }) b: z.infer<typeof depositSchema>) { return this.svc.deposit(a.tenantId, a.userId, 'received', i, b); }
  @RequirePermissions('cheques:post') @RequirePermissions('receivables:post') @HttpCode(200) @Post(':id/clear') @ApiZodBody(clearSchema) clear(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: clearSchema }) b: z.infer<typeof clearSchema>) { return this.svc.clear(a.tenantId, a.userId, 'received', i, b); }
  @RequirePermissions('cheques:post') @HttpCode(200) @Post(':id/bounce') @ApiZodBody(bounceSchema) bounce(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: bounceSchema }) b: z.infer<typeof bounceSchema>) { return this.svc.bounce(a.tenantId, a.userId, 'received', i, b); }
  @RequirePermissions('cheques:post') @HttpCode(200) @Post(':id/cancel') @ApiZodBody(cancelChequeSchema) cancel(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: cancelChequeSchema }) b: z.infer<typeof cancelChequeSchema>) { return this.svc.cancel(a.tenantId, a.userId, 'received', i, b); }
}

@ApiTags('cheques')
@ApiBearerAuth()
@RequiresModule('purchasing')
@Controller('v1/cheques/issued')
export class IssuedChequesController {
  constructor(@Inject(ChequesService) private readonly svc: ChequesService) {}
  @RequirePermissions('cheques:read') @Get() list(@CurrentPrincipal() a: Principal, @Query({ schema: listChequesQuery }) q: z.infer<typeof listChequesQuery>) { return this.svc.list(a.tenantId, 'issued', q); }
  /** Records a cheque written to a supplier. */
  @RequirePermissions('cheques:post') @Idempotent() @Post() @ApiZodBody(createChequeSchema) create(@CurrentPrincipal() a: Principal, @Body({ schema: createChequeSchema }) b: z.infer<typeof createChequeSchema>) { return this.svc.create(a.tenantId, a.userId, 'issued', b); }
  @RequirePermissions('cheques:post') @HttpCode(200) @Post(':id/deposit') @ApiZodBody(depositSchema) deposit(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: depositSchema }) b: z.infer<typeof depositSchema>) { return this.svc.deposit(a.tenantId, a.userId, 'issued', i, b); }
  @RequirePermissions('cheques:post') @RequirePermissions('payables:post') @HttpCode(200) @Post(':id/clear') @ApiZodBody(clearSchema) clear(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: clearSchema }) b: z.infer<typeof clearSchema>) { return this.svc.clear(a.tenantId, a.userId, 'issued', i, b); }
  @RequirePermissions('cheques:post') @HttpCode(200) @Post(':id/bounce') @ApiZodBody(bounceSchema) bounce(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: bounceSchema }) b: z.infer<typeof bounceSchema>) { return this.svc.bounce(a.tenantId, a.userId, 'issued', i, b); }
  @RequirePermissions('cheques:post') @HttpCode(200) @Post(':id/cancel') @ApiZodBody(cancelChequeSchema) cancel(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: cancelChequeSchema }) b: z.infer<typeof cancelChequeSchema>) { return this.svc.cancel(a.tenantId, a.userId, 'issued', i, b); }
}

@Module({ imports: [SalesModule, PurchasingModule], controllers: [ReceivedChequesController, IssuedChequesController], providers: [Recorder, ChequesService] })
export class ChequesModule {}
