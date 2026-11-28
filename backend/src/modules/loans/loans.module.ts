import { Body, Controller, Get, HttpCode, Inject, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { Tx } from '../../platform/database/database.js';
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
import { addMonths, emiOf, schedule, toPaise, toRupees, type Instalment } from './loans.logic.js';

const id = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.string().regex(/^\d{1,14}(\.\d{1,2})?$/, 'An amount such as 100000 or 2500.50').refine((v) => Number(v) > 0, 'Must be more than zero');
const planFields = {
  principal: money, annualRate: z.coerce.number().min(0).max(100), method: z.enum(['reducing', 'flat']).default('reducing'), tenureMonths: z.coerce.number().int().min(1).max(600), firstDueOn: isoDate,
};
export const previewSchema = z.strictObject(planFields);
export const createLoanSchema = z.strictObject({
  companyId: id, direction: z.enum(['taken', 'given']), name: z.string().trim().min(1).max(150), partyId: id.optional(), ...planFields, firstDueOn: isoDate.optional(), disbursedOn: isoDate,
  bankAccountId: id, loanAccountId: id.optional(), interestAccountId: id.optional(), notes: z.string().trim().max(500).optional(),
});
export const listLoansQuery = z.object({ companyId: id, direction: z.enum(['taken', 'given']).optional(), status: z.enum(['active', 'closed', 'cancelled']).optional() });
export const payInstalmentSchema = z.strictObject({ date: isoDate, accountId: id.optional() });
export const forecloseSchema = z.strictObject({ date: isoDate, accountId: id.optional(), interest: z.string().regex(/^\d{1,14}(\.\d{1,2})?$/).default('0') });
export const cancelLoanSchema = z.strictObject({ date: isoDate, reason: z.string().trim().min(1).max(300) });

type LoanRow = { id: string; company_id: string; direction: 'taken' | 'given'; loan_no: string; name: string; party_id: string | null; principal: string; annual_rate: string; method: string; tenure_months: number; disbursed_on: string; first_due_on: string; emi: string;
  loan_account_id: string; interest_account_id: string; bank_account_id: string; status: string; closed_on: string | null; notes: string | null; paid_count: string; outstanding: string; next_due: string | null };
type InstRow = { id: string; no: number; due_date: string; principal: string; interest: string; emi: string; status: string; paid_on: string | null };
const loanOf = (r: LoanRow) => ({ id: r.id, companyId: r.company_id, direction: r.direction, loanNo: r.loan_no, name: r.name, partyId: r.party_id, principal: r.principal, annualRate: r.annual_rate, method: r.method, tenureMonths: r.tenure_months, disbursedOn: r.disbursed_on,
  firstDueOn: r.first_due_on, emi: r.emi, loanAccountId: r.loan_account_id, interestAccountId: r.interest_account_id, bankAccountId: r.bank_account_id, status: r.status, closedOn: r.closed_on, notes: r.notes, paidCount: Number(r.paid_count), outstanding: r.outstanding, nextDue: r.next_due });
const instOf = (r: InstRow) => ({ id: r.id, no: r.no, dueDate: r.due_date, principal: r.principal, interest: r.interest, emi: r.emi, status: r.status, paidOn: r.paid_on });
const SELECT = sql`SELECT l.id, l.company_id, l.direction, l.loan_no, l.name, l.party_id, l.principal::text, l.annual_rate::text, l.method, l.tenure_months, l.disbursed_on::text, l.first_due_on::text, l.emi::text, l.loan_account_id, l.interest_account_id, l.bank_account_id, l.status, l.closed_on::text, l.notes,
  (SELECT count(*) FROM erp.loan_installments i WHERE i.tenant_id = l.tenant_id AND i.loan_id = l.id AND i.status = 'paid')::text AS paid_count,
  COALESCE((SELECT sum(i.principal) FROM erp.loan_installments i WHERE i.tenant_id = l.tenant_id AND i.loan_id = l.id AND i.status = 'due'), 0)::numeric(18,4)::text AS outstanding,
  (SELECT min(i.due_date) FROM erp.loan_installments i WHERE i.tenant_id = l.tenant_id AND i.loan_id = l.id AND i.status = 'due')::text AS next_due
  FROM erp.loans l`;
const plan = (p: z.infer<typeof previewSchema>): Instalment[] => schedule({ principal: Number(p.principal), annualRatePct: p.annualRate, months: p.tenureMonths, method: p.method, firstDue: p.firstDueOn });
const planOut = (rows: Instalment[]) => rows.map((r) => ({ no: r.no, dueDate: r.dueDate, principal: toRupees(r.principal), interest: toRupees(r.interest), emi: toRupees(r.emi) }));

/**
 * Loan accounts. A loan taken from a bank or a person is a liability; a loan given to someone is an asset. Money moves through the books when it is
 * disbursed and when each instalment is paid: the principal part against the loan account, the interest part to expense (taken) or income (given).
 */
@Injectable()
export class LoansService {
  constructor(@Inject(UnitOfWork) private readonly uow: UnitOfWork, @Inject(PostingService) private readonly posting: PostingService, @Inject(Recorder) private readonly recorder: Recorder) {}

  preview(input: z.infer<typeof previewSchema>) { const rows = plan(input); return { emi: toRupees(emiOf(rows)), totalInterest: toRupees(rows.reduce((t, r) => t + r.interest, 0)), totalPayable: toRupees(rows.reduce((t, r) => t + r.emi, 0)), instalments: planOut(rows) }; }

  list(tenantId: string, q: z.infer<typeof listLoansQuery>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = (await tx.execute<LoanRow>(sql`${SELECT} WHERE l.tenant_id = ${tenantId}::uuid AND l.company_id = ${q.companyId}::uuid ${q.direction ? sql`AND l.direction = ${q.direction}` : sql``} ${q.status ? sql`AND l.status = ${q.status}` : sql``} ORDER BY l.disbursed_on DESC, l.loan_no DESC LIMIT 500`)).rows;
      return { items: rows.map(loanOf) };
    }, { readOnly: true });
  }

  get(tenantId: string, loanId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const l = (await tx.execute<LoanRow>(sql`${SELECT} WHERE l.tenant_id = ${tenantId}::uuid AND l.id = ${loanId}::uuid`)).rows[0];
      if (!l) throw new AppError(404, 'not_found', 'Loan was not found');
      const inst = (await tx.execute<InstRow>(sql`SELECT id, no, due_date::text, principal::text, interest::text, emi::text, status, paid_on::text FROM erp.loan_installments WHERE tenant_id = ${tenantId}::uuid AND loan_id = ${loanId}::uuid ORDER BY no`)).rows;
      return { ...loanOf(l), instalments: inst.map(instOf) };
    }, { readOnly: true });
  }

  private async account(tx: Tx, tenantId: string, companyId: string, accountId: string | undefined, code: string, types: string[], what: string): Promise<string> {
    const r = (await tx.execute<{ id: string; type: string; is_group: boolean; status: string }>(sql`SELECT id, type, is_group, status FROM erp.accounts WHERE tenant_id = ${tenantId}::uuid AND company_id = ${companyId}::uuid AND ${accountId ? sql`id = ${accountId}::uuid` : sql`code = ${code}`} LIMIT 1`)).rows[0];
    if (!r) throw validationFailed([{ path: 'accounts', message: accountId ? `${what} was not found` : `Choose the ${what}: this company has no account ${code}` }]);
    if (r.is_group || r.status !== 'active' || !types.includes(r.type)) throw validationFailed([{ path: 'accounts', message: `The ${what} must be an active ${types.join(' or ')} account that can be posted to` }]);
    return r.id;
  }
  create(tenantId: string, actorId: string, input: z.infer<typeof createLoanSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const taken = input.direction === 'taken';
      if (!taken) { await ensureAccount(tx, tenantId, input.companyId, { code: '1150', name: 'Loans given', type: 'asset', parentCode: '1100' }); await ensureAccount(tx, tenantId, input.companyId, { code: '4910', name: 'Interest income', type: 'income', parentCode: '4000' }); }
      const loanAccountId = await this.account(tx, tenantId, input.companyId, input.loanAccountId, taken ? '2310' : '1150', taken ? ['liability'] : ['asset'], taken ? 'loan (liability) account' : 'loans given (asset) account');
      const interestAccountId = await this.account(tx, tenantId, input.companyId, input.interestAccountId, taken ? '5800' : '4910', taken ? ['expense'] : ['income'], taken ? 'interest expense account' : 'interest income account');
      const bankAccountId = await this.account(tx, tenantId, input.companyId, input.bankAccountId, '1120', ['asset'], 'bank or cash account');
      if (input.partyId) { const p = (await tx.execute(sql`SELECT 1 FROM erp.parties WHERE tenant_id = ${tenantId}::uuid AND id = ${input.partyId}::uuid`)).rows[0]; if (!p) throw new AppError(404, 'not_found', 'Party was not found'); }
      const firstDueOn = input.firstDueOn ?? addMonths(input.disbursedOn, 1);
      const rows = plan({ ...input, firstDueOn });
      const next = Number((await tx.execute<{ n: string }>(sql`SELECT COALESCE(max(NULLIF(regexp_replace(loan_no, '\\D', '', 'g'), '')::int), 0) + 1 AS n FROM erp.loans WHERE tenant_id = ${tenantId}::uuid AND company_id = ${input.companyId}::uuid`)).rows[0]?.n ?? 1);
      const loanNo = `LN-${String(next).padStart(4, '0')}`;
      const loanId = uuidv7();
      await tx.execute(sql`INSERT INTO erp.loans (tenant_id, id, company_id, direction, loan_no, name, party_id, principal, annual_rate, method, tenure_months, disbursed_on, first_due_on, emi, loan_account_id, interest_account_id, bank_account_id, notes, created_by)
        VALUES (${tenantId}::uuid, ${loanId}::uuid, ${input.companyId}::uuid, ${input.direction}, ${loanNo}, ${input.name}, ${input.partyId ?? null}, ${input.principal}::numeric, ${input.annualRate}::numeric, ${input.method}, ${input.tenureMonths}, ${input.disbursedOn}::date, ${firstDueOn}::date, ${toRupees(emiOf(rows))}::numeric, ${loanAccountId}::uuid, ${interestAccountId}::uuid, ${bankAccountId}::uuid, ${input.notes ?? null}, ${actorId}::uuid)`);
      for (const r of rows) await tx.execute(sql`INSERT INTO erp.loan_installments (tenant_id, id, loan_id, no, due_date, principal, interest, emi) VALUES (${tenantId}::uuid, ${uuidv7()}::uuid, ${loanId}::uuid, ${r.no}, ${r.dueDate}::date, ${toRupees(r.principal)}::numeric, ${toRupees(r.interest)}::numeric, ${toRupees(r.emi)}::numeric)`);
      // the money moves: borrowed money comes into the bank, lent money goes out
      const entry = await this.posting.post(tx, tenantId, {
        companyId: input.companyId, postingDate: input.disbursedOn, journalType: 'system', description: `${taken ? 'Loan taken' : 'Loan given'} ${loanNo} · ${input.name}`, source: { type: 'loan', id: loanId, event: 'disbursal' }, postedBy: actorId,
        lines: taken ? [{ accountId: bankAccountId, debit: input.principal }, { accountId: loanAccountId, credit: input.principal }] : [{ accountId: loanAccountId, debit: input.principal, ...(input.partyId ? { partyId: input.partyId } : {}) }, { accountId: bankAccountId, credit: input.principal }],
      });
      await tx.execute(sql`UPDATE erp.loans SET disbursal_entry_id = ${entry.entry.id}::uuid WHERE tenant_id = ${tenantId}::uuid AND id = ${loanId}::uuid`);
      await this.recorder.record(tx, tenantId, 'loan', 'created', { id: loanId }, { loanNo, direction: input.direction, principal: input.principal });
      return loanId;
    }).then((loanId) => this.get(tenantId, loanId));
  }

  private async lockLoan(tx: Tx, tenantId: string, loanId: string) {
    const l = (await tx.execute<{ id: string; company_id: string; direction: 'taken' | 'given'; loan_no: string; party_id: string | null; loan_account_id: string; interest_account_id: string; bank_account_id: string; status: string; disbursal_entry_id: string | null; name: string }>(sql`SELECT id, company_id, direction, loan_no, name, party_id, loan_account_id, interest_account_id, bank_account_id, status, disbursal_entry_id FROM erp.loans WHERE tenant_id = ${tenantId}::uuid AND id = ${loanId}::uuid FOR UPDATE`)).rows[0];
    if (!l) throw new AppError(404, 'not_found', 'Loan was not found');
    return l;
  }
  /** What one payment posts: principal against the loan account, interest to the expense or income account, and the whole amount through the bank. */
  private paymentLines(l: Awaited<ReturnType<LoansService['lockLoan']>>, bankId: string, principal: number, interest: number) {
    const p = toRupees(principal), i = toRupees(interest), total = toRupees(principal + interest);
    const party = l.party_id ? { partyId: l.party_id } : {};
    return l.direction === 'taken'
      ? [{ accountId: l.loan_account_id, debit: p }, ...(interest > 0 ? [{ accountId: l.interest_account_id, debit: i }] : []), { accountId: bankId, credit: total }]
      : [{ accountId: bankId, debit: total }, { accountId: l.loan_account_id, credit: p, ...party }, ...(interest > 0 ? [{ accountId: l.interest_account_id, credit: i }] : [])];
  }

  payInstalment(tenantId: string, actorId: string, loanId: string, no: number, input: z.infer<typeof payInstalmentSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const l = await this.lockLoan(tx, tenantId, loanId);
      if (l.status !== 'active') throw new AppError(409, 'wrong_status', `This loan is ${l.status}`);
      const inst = (await tx.execute<{ id: string; principal: string; interest: string; status: string }>(sql`SELECT id, principal::text, interest::text, status FROM erp.loan_installments WHERE tenant_id = ${tenantId}::uuid AND loan_id = ${loanId}::uuid AND no = ${no} FOR UPDATE`)).rows[0];
      if (!inst) throw new AppError(404, 'not_found', `Instalment ${no} was not found`);
      if (inst.status !== 'due') throw new AppError(409, 'wrong_status', `Instalment ${no} is already ${inst.status}`);
      const earlier = (await tx.execute(sql`SELECT 1 FROM erp.loan_installments WHERE tenant_id = ${tenantId}::uuid AND loan_id = ${loanId}::uuid AND no < ${no} AND status = 'due' LIMIT 1`)).rows[0];
      if (earlier) throw new AppError(409, 'out_of_order', 'Pay the earlier instalments first');
      const bank = input.accountId ?? l.bank_account_id;
      const e = await this.posting.post(tx, tenantId, { companyId: l.company_id, postingDate: input.date, journalType: 'system', description: `${l.loan_no} instalment ${no} · ${l.name}`, source: { type: 'loan', id: inst.id, event: 'paid' }, postedBy: actorId, lines: this.paymentLines(l, bank, toPaise(inst.principal), toPaise(inst.interest)) });
      await tx.execute(sql`UPDATE erp.loan_installments SET status = 'paid', paid_on = ${input.date}::date, paid_account_id = ${bank}::uuid, entry_id = ${e.entry.id}::uuid WHERE tenant_id = ${tenantId}::uuid AND id = ${inst.id}::uuid`);
      const left = (await tx.execute(sql`SELECT 1 FROM erp.loan_installments WHERE tenant_id = ${tenantId}::uuid AND loan_id = ${loanId}::uuid AND status = 'due' LIMIT 1`)).rows[0];
      if (!left) await tx.execute(sql`UPDATE erp.loans SET status = 'closed', closed_on = ${input.date}::date, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${loanId}::uuid`);
      await this.recorder.record(tx, tenantId, 'loan', 'instalment_paid', { id: loanId }, { no, date: input.date });
    }).then(() => this.get(tenantId, loanId));
  }

  /** Paying the rest early: what is still owed of the principal, plus whatever interest the lender charges up to that day. */
  foreclose(tenantId: string, actorId: string, loanId: string, input: z.infer<typeof forecloseSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const l = await this.lockLoan(tx, tenantId, loanId);
      if (l.status !== 'active') throw new AppError(409, 'wrong_status', `This loan is ${l.status}`);
      const owed = toPaise((await tx.execute<{ s: string }>(sql`SELECT COALESCE(sum(principal), 0)::text AS s FROM erp.loan_installments WHERE tenant_id = ${tenantId}::uuid AND loan_id = ${loanId}::uuid AND status = 'due'`)).rows[0]?.s ?? '0');
      if (owed <= 0) throw new AppError(409, 'nothing_owed', 'Nothing is outstanding on this loan');
      const bank = input.accountId ?? l.bank_account_id;
      const e = await this.posting.post(tx, tenantId, { companyId: l.company_id, postingDate: input.date, journalType: 'system', description: `${l.loan_no} closed early · ${l.name}`, source: { type: 'loan', id: l.id, event: 'foreclosed' }, postedBy: actorId, lines: this.paymentLines(l, bank, owed, toPaise(input.interest)) });
      await tx.execute(sql`UPDATE erp.loan_installments SET status = 'waived', paid_on = ${input.date}::date, entry_id = ${e.entry.id}::uuid WHERE tenant_id = ${tenantId}::uuid AND loan_id = ${loanId}::uuid AND status = 'due'`);
      await tx.execute(sql`UPDATE erp.loans SET status = 'closed', closed_on = ${input.date}::date, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${loanId}::uuid`);
      await this.recorder.record(tx, tenantId, 'loan', 'foreclosed', { id: loanId }, { date: input.date, principal: toRupees(owed), interest: input.interest });
    }).then(() => this.get(tenantId, loanId));
  }

  /** Undo a loan that was entered by mistake: only while no instalment has been paid. The disbursal is reversed. */
  cancel(tenantId: string, actorId: string, loanId: string, input: z.infer<typeof cancelLoanSchema>) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const l = await this.lockLoan(tx, tenantId, loanId);
      if (l.status !== 'active') throw new AppError(409, 'wrong_status', `This loan is ${l.status}`);
      const paid = (await tx.execute(sql`SELECT 1 FROM erp.loan_installments WHERE tenant_id = ${tenantId}::uuid AND loan_id = ${loanId}::uuid AND status <> 'due' LIMIT 1`)).rows[0];
      if (paid) throw new AppError(409, 'has_payments', 'Instalments have been paid on this loan. Close it early instead.');
      if (l.disbursal_entry_id) await this.posting.reverse(tx, tenantId, l.disbursal_entry_id, { postingDate: input.date, reason: input.reason, postedBy: actorId, allowSystem: true });
      await tx.execute(sql`UPDATE erp.loan_installments SET status = 'waived' WHERE tenant_id = ${tenantId}::uuid AND loan_id = ${loanId}::uuid`);
      await tx.execute(sql`UPDATE erp.loans SET status = 'cancelled', closed_on = ${input.date}::date, notes = COALESCE(notes || ' · ', '') || ${`Cancelled: ${input.reason}`}, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND id = ${loanId}::uuid`);
      await this.recorder.record(tx, tenantId, 'loan', 'cancelled', { id: loanId }, { reason: input.reason });
    }).then(() => this.get(tenantId, loanId));
  }
}

@ApiTags('loans')
@ApiBearerAuth()
@RequiresModule('accounting')
@Controller('v1/loans')
export class LoansController {
  constructor(@Inject(LoansService) private readonly svc: LoansService) {}
  /** The repayment schedule for a loan being considered; nothing is saved. */
  @RequirePermissions('loans:read') @HttpCode(200) @Post('preview') @ApiZodBody(previewSchema) preview(@Body({ schema: previewSchema }) b: z.infer<typeof previewSchema>) { return this.svc.preview(b); }
  @RequirePermissions('loans:read') @Get() list(@CurrentPrincipal() a: Principal, @Query({ schema: listLoansQuery }) q: z.infer<typeof listLoansQuery>) { return this.svc.list(a.tenantId, q); }
  @RequirePermissions('loans:read') @Get(':id') get(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string) { return this.svc.get(a.tenantId, i); }
  @RequirePermissions('loans:post') @Idempotent() @Post() @ApiZodBody(createLoanSchema) create(@CurrentPrincipal() a: Principal, @Body({ schema: createLoanSchema }) b: z.infer<typeof createLoanSchema>) { return this.svc.create(a.tenantId, a.userId, b); }
  @RequirePermissions('loans:post') @HttpCode(200) @Post(':id/instalments/:no/pay') @ApiZodBody(payInstalmentSchema) pay(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Param('no') no: string, @Body({ schema: payInstalmentSchema }) b: z.infer<typeof payInstalmentSchema>) { return this.svc.payInstalment(a.tenantId, a.userId, i, Number(no), b); }
  @RequirePermissions('loans:post') @HttpCode(200) @Post(':id/foreclose') @ApiZodBody(forecloseSchema) foreclose(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: forecloseSchema }) b: z.infer<typeof forecloseSchema>) { return this.svc.foreclose(a.tenantId, a.userId, i, b); }
  @RequirePermissions('loans:post') @HttpCode(200) @Post(':id/cancel') @ApiZodBody(cancelLoanSchema) cancel(@CurrentPrincipal() a: Principal, @Param('id', { schema: id }) i: string, @Body({ schema: cancelLoanSchema }) b: z.infer<typeof cancelLoanSchema>) { return this.svc.cancel(a.tenantId, a.userId, i, b); }
}

@Module({ imports: [AccountingModule], controllers: [LoansController], providers: [Recorder, LoansService] })
export class LoansModule {}
