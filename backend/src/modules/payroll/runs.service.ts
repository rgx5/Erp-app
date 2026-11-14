import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, lte, ne, or, gte, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { accounts } from '../accounting/accounting.schema.js';
import { fromUnits, toUnits } from '../accounting/money.js';
import { PostingService, type PostingLine } from '../accounting/posting.service.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { nextDocNumber } from '../sales/doc-number.js';
import { calculate, type ComponentIn } from './payroll-calc.js';
import { employees, payrollInputs, payrollRuns, payslips, statutoryRemittances } from './payroll.schema.js';
import type { CreateRunInput, RemitInput } from './payroll.schemas.js';
import { PayrollMastersService } from './masters.service.js';
import { resolveRules } from './rules.js';

export type RunRow = typeof payrollRuns.$inferSelect;
const u = toUnits;
const m = fromUnits;
const pctUnits = (text: string): bigint => { const [i = '0', f = ''] = text.split('.'); return BigInt(i) * 10_000n + BigInt(f.padEnd(4, '0').slice(0, 4)); };
const hundredths = (text: string): bigint => { const [i = '0', f = ''] = text.split('.'); return BigInt(i) * 100n + BigInt(f.padEnd(2, '0').slice(0, 2)); };
const daysIn = (period: string): number => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
const financialYearStart = (period: string): string => { const y = Number(period.slice(0, 4)); const mo = Number(period.slice(5, 7)); return `${mo >= 4 ? y : y - 1}-04`; };
const monthsLeft = (period: string): number => { const mo = Number(period.slice(5, 7)); return mo >= 4 ? 16 - mo : 4 - mo; }; // April: 12 ... March: 1
const KIND_ACCOUNT = { pf: 'pfPayableAccountId', esi: 'esiPayableAccountId', pt: 'ptPayableAccountId', tds: 'tdsPayableAccountId' } as const;
const KIND_TOTAL = { pf: 'pfTotal', esi: 'esiTotal', pt: 'ptTotal', tds: 'tdsTotal' } as const;

/**
 * Monthly payroll: every active employee and contract worker is paid from their salary structure, attendance inputs and the statutory
 * rules in force, in one transaction that writes the immutable run and payslips and the accounting journal. Net pay and statutory
 * deductions are liabilities until paid and remitted; a run can be cancelled only while unpaid.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(PayrollMastersService) private readonly masters: PayrollMastersService,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {
    this.masters.onPeriodCheck(async (tx, tenantId, companyId, period) => {
      const [r] = await tx.select({ no: payrollRuns.runNo }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period), ne(payrollRuns.status, 'cancelled')));
      if (r) throw new AppError(409, 'period_processed', `Payroll for ${period} was already run (${r.no}); cancel it first to change the inputs`);
    });
  }

  create(tenantId: string, actorId: string, input: CreateRunInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [live] = await tx.select({ no: payrollRuns.runNo }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.companyId, input.companyId), eq(payrollRuns.period, input.period), ne(payrollRuns.status, 'cancelled')));
      if (live) throw new AppError(409, 'run_exists', `Payroll for ${input.period} was already run (${live.no})`);
      const from = `${input.period}-01`;
      const monthDays = daysIn(input.period);
      const to = `${input.period}-${String(monthDays).padStart(2, '0')}`;
      const people = await tx.select().from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.companyId, input.companyId), lte(employees.dateOfJoining, to), or(isNull(employees.dateOfLeaving), gte(employees.dateOfLeaving, from)))).orderBy(asc(employees.employeeNo));
      if (people.length === 0) throw new AppError(422, 'no_payroll', 'Nobody is employed in this month');
      const inputs = new Map((await tx.select().from(payrollInputs).where(and(eq(payrollInputs.tenantId, tenantId), eq(payrollInputs.period, input.period), inArray(payrollInputs.employeeId, people.map((p) => p.id))))).map((i) => [i.employeeId, i]));
      const fy = financialYearStart(input.period);
      const slips: { person: (typeof people)[number]; p: ReturnType<typeof calculate>; detail: Record<string, unknown> }[] = [];
      const problems: { employeeNo: string; problem: string }[] = [];
      for (const person of people) {
        const start = person.dateOfJoining > from ? person.dateOfJoining : from;
        const end = person.dateOfLeaving && person.dateOfLeaving < to ? person.dateOfLeaving : to;
        const employedDays = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
        const struct = await this.masters.structureOn(tx, tenantId, person.id, start);
        if (!struct) { problems.push({ employeeNo: person.employeeNo, problem: 'no salary structure in force' }); continue; }
        const inp = inputs.get(person.id);
        if (person.payBasis !== 'monthly' && !inp?.unitsWorked) { problems.push({ employeeNo: person.employeeNo, problem: `no ${person.payBasis === 'daily' ? 'days' : 'hours'} worked entered` }); continue; }
        const { rules, missing } = await resolveRules(tx, tenantId, input.companyId, from, person.taxRegime as 'new' | 'old', person.stateCode);
        const relevant = missing.filter((c) => (person.pfApplicable && c.startsWith('pf_')) || (person.esiApplicable && c.startsWith('esi_')) || (person.ptApplicable && c.startsWith('pt')) || (person.kind === 'employee' && (c.startsWith('tds_') || c.startsWith('tds'))));
        if (relevant.length > 0) { problems.push({ employeeNo: person.employeeNo, problem: `statutory rules missing: ${relevant.join(', ')}` }); continue; }
        const ytd = await tx.execute<{ taxable: string; tds: string }>(sql`
          SELECT COALESCE(SUM((s.detail->>'taxableGross')::numeric), 0)::text AS taxable, COALESCE(SUM(s.tds), 0)::text AS tds
            FROM erp.payslips s JOIN erp.payroll_runs r ON r.tenant_id = s.tenant_id AND r.id = s.run_id
           WHERE s.tenant_id = ${tenantId}::uuid AND s.employee_id = ${person.id}::uuid AND r.status <> 'cancelled' AND s.period >= ${fy} AND s.period < ${input.period}`);
        const components: ComponentIn[] = struct.lines.map(({ line, c }) => ({ code: c.code, name: c.name, kind: c.kind as 'earning' | 'deduction', calculation: c.calculation as 'fixed' | 'percent_of_basic', percent: c.percent === null ? null : pctUnits(c.percent), amount: line.amount === null ? null : u(line.amount), taxable: c.isTaxable, pfWage: c.pfWage, esiWage: c.esiWage }));
        const p = calculate({
          kind: person.kind as 'employee' | 'contract_worker', payBasis: person.payBasis as 'monthly' | 'daily' | 'hourly', monthDays, lopDays: hundredths(inp?.lopDays ?? '0') + BigInt(monthDays - employedDays) * 100n, unitsWorked: inp?.unitsWorked ? hundredths(inp.unitsWorked) : null,
          basic: u(struct.structure.basic), components, bonus: u(inp?.bonus ?? '0'), otherDeduction: u(inp?.otherDeduction ?? '0'), pfApplicable: person.pfApplicable, esiApplicable: person.esiApplicable, ptApplicable: person.ptApplicable,
          tdsRatePercent: person.tdsRatePercent === null ? null : pctUnits(person.tdsRatePercent), rules, ytdTaxable: u(ytd.rows[0]?.taxable ?? '0'), ytdTds: u(ytd.rows[0]?.tds ?? '0'), remainingMonths: monthsLeft(input.period),
        });
        slips.push({ person, p, detail: {
          structureEffectiveFrom: struct.structure.effectiveFrom, taxRegime: person.taxRegime, payBasis: person.payBasis, paidDays: p.paidDaysFactor, earnings: p.earnings.map((l) => ({ ...l, amount: m(l.amount) })), bonus: m(p.bonus), deductions: p.deductions.map((l) => ({ ...l, amount: m(l.amount) })), otherDeduction: m(p.otherDeduction),
          taxableGross: m(p.taxableGross), pfWages: m(p.pfWages), esiWages: m(p.esiWages), tdsBasis: p.tdsBasis ? { projectedAnnual: m(p.tdsBasis.projectedAnnual), taxableIncome: m(p.tdsBasis.taxableIncome), annualTax: m(p.tdsBasis.annualTax), cess: m(p.tdsBasis.cess) } : null, employerCost: m(p.employerCost),
        } });
      }
      if (problems.length > 0) throw new AppError(422, 'payroll_not_ready', 'Some people cannot be paid yet', { problems });

      const sum = (pick: (s: (typeof slips)[number]) => bigint) => slips.reduce((a, s) => a + pick(s), 0n);
      const gross = sum((s) => s.p.gross);
      const pfEe = sum((s) => s.p.pfEmployee); const pfEr = sum((s) => s.p.pfEmployer); const esiEe = sum((s) => s.p.esiEmployee); const esiEr = sum((s) => s.p.esiEmployer);
      const pt = sum((s) => s.p.professionalTax); const tds = sum((s) => s.p.tds);
      const other = sum((s) => s.p.deductions.reduce((a, l) => a + l.amount, 0n) + s.p.otherDeduction);
      const net = sum((s) => s.p.net);
      const employerCost = pfEr + esiEr;
      const needs: Parameters<PayrollMastersService['requireSettings']>[3] = ['salaryExpenseAccountId', 'salaryPayableAccountId'];
      if (employerCost > 0n) needs.push('employerCostAccountId');
      if (pfEe + pfEr > 0n) needs.push('pfPayableAccountId');
      if (esiEe + esiEr > 0n) needs.push('esiPayableAccountId');
      if (pt > 0n) needs.push('ptPayableAccountId');
      if (tds > 0n) needs.push('tdsPayableAccountId');
      if (other > 0n) needs.push('otherDeductionsAccountId');
      const acc = await this.masters.requireSettings(tx, tenantId, input.companyId, needs);

      const id = uuidv7();
      const runNo = await nextDocNumber(tx, tenantId, input.companyId, input.payDate, 'PR');
      const lines: PostingLine[] = [];
      const add = (accountId: string | null, units: bigint, side: 'debit' | 'credit') => { if (units !== 0n && accountId) lines.push({ accountId, [side]: m(units), description: runNo }); };
      add(acc.salaryExpenseAccountId, gross, 'debit');
      add(acc.employerCostAccountId, employerCost, 'debit');
      add(acc.salaryPayableAccountId, net, 'credit');
      add(acc.pfPayableAccountId, pfEe + pfEr, 'credit');
      add(acc.esiPayableAccountId, esiEe + esiEr, 'credit');
      add(acc.ptPayableAccountId, pt, 'credit');
      add(acc.tdsPayableAccountId, tds, 'credit');
      add(acc.otherDeductionsAccountId, other, 'credit');
      const { entry } = await this.posting.post(tx, tenantId, { companyId: input.companyId, postingDate: input.payDate, journalType: 'system', description: `Payroll ${runNo} for ${input.period}`, lines, source: { type: 'payroll_run', id, event: 'post' }, postedBy: actorId });
      const run = first(await tx.insert(payrollRuns).values({ tenantId, id, companyId: input.companyId, runNo, period: input.period, payDate: input.payDate, grossTotal: m(gross), employeeDeductions: m(gross - net), netTotal: m(net), employerCostTotal: m(gross + employerCost), pfTotal: m(pfEe + pfEr), esiTotal: m(esiEe + esiEr), ptTotal: m(pt), tdsTotal: m(tds), journalEntryId: entry.id, createdBy: actorId }).returning(), 'Payroll run');
      await tx.insert(payslips).values(slips.map((s) => ({
        tenantId, id: uuidv7(), runId: id, employeeId: s.person.id, employeeNo: s.person.employeeNo, employeeName: s.person.fullName, kind: s.person.kind, period: input.period, gross: m(s.p.gross), pfEmployee: m(s.p.pfEmployee), pfEmployer: m(s.p.pfEmployer),
        esiEmployee: m(s.p.esiEmployee), esiEmployer: m(s.p.esiEmployer), professionalTax: m(s.p.professionalTax), tds: m(s.p.tds), otherDeductions: m(s.p.deductions.reduce((a, l) => a + l.amount, 0n) + s.p.otherDeduction), net: m(s.p.net), detail: s.detail,
      })));
      await this.recorder.record(tx, tenantId, 'payroll_run', 'posted', run, { runNo, period: input.period, people: slips.length, gross: run.grossTotal, net: run.netTotal });
      return this.read(tx, tenantId, id);
    });
  }

  /** Pays the net salaries of a run in one go: Dr salary payable, Cr cash or bank. */
  pay(tenantId: string, actorId: string, id: string, input: { date: string; paidFromAccountId: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const run = first(await tx.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, id))).for('update'), 'Payroll run');
      if (run.status !== 'posted') throw new AppError(409, 'not_payable', `This run is ${run.status}`);
      if (input.date < run.payDate) throw validationFailed([{ path: 'date', message: 'Cannot be before the pay date' }]);
      await this.requireCash(tx, tenantId, run.companyId, input.paidFromAccountId, 'paidFromAccountId');
      const acc = await this.masters.requireSettings(tx, tenantId, run.companyId, ['salaryPayableAccountId']);
      const { entry } = await this.posting.post(tx, tenantId, { companyId: run.companyId, postingDate: input.date, journalType: 'system', description: `Salaries paid, ${run.runNo}`, lines: [{ accountId: acc.salaryPayableAccountId as string, debit: run.netTotal }, { accountId: input.paidFromAccountId, credit: run.netTotal }], source: { type: 'payroll_run', id, event: 'pay' }, postedBy: actorId });
      const updated = first(await tx.update(payrollRuns).set({ status: 'paid', paidOn: input.date, paymentJournalId: entry.id }).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, id))).returning(), 'Payroll run');
      await this.recorder.record(tx, tenantId, 'payroll_run', 'paid', updated, { runNo: updated.runNo, amount: updated.netTotal });
      return this.read(tx, tenantId, id);
    });
  }

  /** Cancels an unpaid run (reverses its journal); the month can then be run again. */
  cancel(tenantId: string, actorId: string, id: string, input: { date: string; reason: string }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const run = first(await tx.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, id))).for('update'), 'Payroll run');
      if (run.status !== 'posted') throw new AppError(409, 'not_cancellable', run.status === 'paid' ? 'Salaries were paid: a paid run cannot be cancelled' : `This run is ${run.status}`);
      const [remitted] = await tx.select({ n: statutoryRemittances.remittanceNo }).from(statutoryRemittances).where(and(eq(statutoryRemittances.tenantId, tenantId), eq(statutoryRemittances.companyId, run.companyId), eq(statutoryRemittances.period, run.period))).limit(1);
      if (remitted) throw new AppError(409, 'has_remittances', `Remittance ${remitted.n} was made for ${run.period}`);
      if (input.date < run.payDate) throw validationFailed([{ path: 'date', message: 'Cannot be before the pay date' }]);
      const { entry } = await this.posting.reverse(tx, tenantId, run.journalEntryId as string, { postingDate: input.date, reason: `Cancelled: ${input.reason}`, postedBy: actorId, allowSystem: true });
      const updated = first(await tx.update(payrollRuns).set({ status: 'cancelled', cancelledAt: new Date(), cancelReason: input.reason, cancelJournalId: entry.id }).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, id))).returning(), 'Payroll run');
      await this.recorder.record(tx, tenantId, 'payroll_run', 'cancelled', updated, { runNo: updated.runNo, reason: input.reason });
      return this.read(tx, tenantId, id);
    });
  }

  // ---- statutory remittances ---------------------------------------------------------------------------------------------------------
  /** Pays PF, ESI, professional tax or TDS deducted in a month to the authority: Dr the liability, Cr cash or bank. Never more than is owed. */
  remit(tenantId: string, actorId: string, input: RemitInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const owed = await this.outstanding(tx, tenantId, input.companyId, input.period, input.kind);
      if (u(input.amount) > owed) throw new AppError(409, 'exceeds_outstanding', `Only ${m(owed)} of ${input.kind.toUpperCase()} for ${input.period} is still to be remitted`, { outstanding: m(owed) });
      await this.requireCash(tx, tenantId, input.companyId, input.paidFromAccountId, 'paidFromAccountId');
      const acc = await this.masters.requireSettings(tx, tenantId, input.companyId, [KIND_ACCOUNT[input.kind]]);
      const remittanceNo = await nextDocNumber(tx, tenantId, input.companyId, input.date, 'REM');
      const id = uuidv7();
      const { entry } = await this.posting.post(tx, tenantId, { companyId: input.companyId, postingDate: input.date, journalType: 'system', description: `${input.kind.toUpperCase()} remitted for ${input.period}`, lines: [{ accountId: acc[KIND_ACCOUNT[input.kind]] as string, debit: input.amount, description: remittanceNo }, { accountId: input.paidFromAccountId, credit: input.amount, description: remittanceNo }], source: { type: 'statutory_remittance', id, event: 'post' }, postedBy: actorId });
      const row = first(await tx.insert(statutoryRemittances).values({ tenantId, id, companyId: input.companyId, remittanceNo, kind: input.kind, period: input.period, remittedOn: input.date, amount: input.amount, reference: input.reference ?? null, journalEntryId: entry.id, createdBy: actorId }).returning(), 'Remittance');
      await this.recorder.record(tx, tenantId, 'statutory_remittance', 'posted', row, { remittanceNo, kind: input.kind, period: input.period, amount: input.amount });
      return row;
    });
  }
  private async outstanding(tx: Tx, tenantId: string, companyId: string, period: string, kind: keyof typeof KIND_ACCOUNT): Promise<bigint> {
    const col = KIND_TOTAL[kind];
    const [due] = await tx.select({ v: sql<string>`COALESCE(SUM(${payrollRuns[col]}), 0)::text` }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.companyId, companyId), eq(payrollRuns.period, period), ne(payrollRuns.status, 'cancelled')));
    const [paid] = await tx.select({ v: sql<string>`COALESCE(SUM(${statutoryRemittances.amount}), 0)::text` }).from(statutoryRemittances).where(and(eq(statutoryRemittances.tenantId, tenantId), eq(statutoryRemittances.companyId, companyId), eq(statutoryRemittances.period, period), eq(statutoryRemittances.kind, kind)));
    return u(due?.v ?? '0') - u(paid?.v ?? '0');
  }
  /** What is still owed to the authorities, by month and kind. */
  liabilities(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const periods = await tx.select({ p: payrollRuns.period }).from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.companyId, companyId), ne(payrollRuns.status, 'cancelled'))).orderBy(asc(payrollRuns.period));
      const rows = [];
      for (const { p } of periods) {
        const o = { pf: m(await this.outstanding(tx, tenantId, companyId, p, 'pf')), esi: m(await this.outstanding(tx, tenantId, companyId, p, 'esi')), pt: m(await this.outstanding(tx, tenantId, companyId, p, 'pt')), tds: m(await this.outstanding(tx, tenantId, companyId, p, 'tds')) };
        rows.push({ period: p, ...o });
      }
      return { periods: rows };
    }, { readOnly: true });
  }

  private async requireCash(tx: Tx, tenantId: string, companyId: string, accountId: string, path: string): Promise<void> {
    const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, accountId)));
    if (!a || a.type !== 'asset' || a.isGroup || a.status !== 'active' || a.controlKind) throw validationFailed([{ path, message: 'Must be an active cash or bank (non-control asset) account of this company' }]);
  }

  // ---- reads ----------------------------------------------------------------------------------------------------------------------------
  get(tenantId: string, id: string) { return this.uow.inTenant(tenantId, (tx) => this.read(tx, tenantId, id), { readOnly: true }); }
  private async read(tx: Tx, tenantId: string, id: string) {
    return { run: first(await tx.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.id, id))), 'Payroll run'), payslips: await tx.select().from(payslips).where(and(eq(payslips.tenantId, tenantId), eq(payslips.runId, id))).orderBy(asc(payslips.employeeNo)) };
  }
  list(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(payrollRuns).where(and(eq(payrollRuns.tenantId, tenantId), eq(payrollRuns.companyId, q.companyId), before ? lt(payrollRuns.id, before) : undefined, q.status ? eq(payrollRuns.status, q.status) : undefined)).orderBy(desc(payrollRuns.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }
  /** One person's payslips, newest first. */
  payslipsOf(tenantId: string, employeeId: string) {
    return this.uow.inTenant(tenantId, (tx) => tx.select({ p: payslips, status: payrollRuns.status }).from(payslips).innerJoin(payrollRuns, and(eq(payrollRuns.tenantId, payslips.tenantId), eq(payrollRuns.id, payslips.runId))).where(and(eq(payslips.tenantId, tenantId), eq(payslips.employeeId, employeeId), ne(payrollRuns.status, 'cancelled'))).orderBy(desc(payslips.period)).then((r) => r.map((x) => x.p)), { readOnly: true });
  }
}
