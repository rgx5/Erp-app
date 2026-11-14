import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lt, lte, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, encodeCursor } from '../../platform/http/validation.js';
import { accounts } from '../accounting/accounting.schema.js';
import { first, Recorder } from '../masterdata/helpers.js';
import { DEFAULT_PT_MAHARASHTRA, DEFAULT_RATES, DEFAULT_TDS_NEW, DEFAULT_TDS_OLD } from './defaults.js';
import { employees, payrollInputs, payrollRates, payrollSettings, payrollSlabs, salaryComponents, salaryStructureLines, salaryStructures } from './payroll.schema.js';
import type { CreateComponentInput, CreateEmployeeInput, CreateStructureInput, PayrollSettingsInput, PutInputInput, PutRatesInput, PutSlabsInput, UpdateEmployeeInput } from './payroll.schemas.js';
import { resolveRules } from './rules.js';

const f4 = (u: bigint): string => `${u / 10_000n}.${(u % 10_000n).toString().padStart(4, '0')}`;
export type EmployeeRow = typeof employees.$inferSelect;
export type PayrollSettingsRow = typeof payrollSettings.$inferSelect;
export type PayrollAccount = keyof PayrollSettingsInput;

const ACCOUNT_RULES: Record<PayrollAccount, { type: string; controls: (string | null)[]; label: string }> = {
  salaryExpenseAccountId: { type: 'expense', controls: [null], label: 'an ordinary expense account' },
  employerCostAccountId: { type: 'expense', controls: [null], label: 'an ordinary expense account' },
  salaryPayableAccountId: { type: 'liability', controls: [null], label: 'an ordinary liability account' },
  pfPayableAccountId: { type: 'liability', controls: [null, 'tax'], label: 'a liability account (ordinary or tax control)' },
  esiPayableAccountId: { type: 'liability', controls: [null, 'tax'], label: 'a liability account (ordinary or tax control)' },
  ptPayableAccountId: { type: 'liability', controls: [null, 'tax'], label: 'a liability account (ordinary or tax control)' },
  tdsPayableAccountId: { type: 'liability', controls: [null, 'tax'], label: 'a liability account (ordinary or tax control)' },
  otherDeductionsAccountId: { type: 'liability', controls: [null], label: 'an ordinary liability account' },
};

/** Employees and contract workers, salary components and structures, monthly inputs, and the statutory rules. */
@Injectable()
export class PayrollMastersService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(Recorder) private readonly recorder: Recorder,
  ) {}

  // ---- settings -------------------------------------------------------------------------------------------------------------
  getSettings(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, async (tx) => (await tx.select().from(payrollSettings).where(and(eq(payrollSettings.tenantId, tenantId), eq(payrollSettings.companyId, companyId))))[0] ?? null, { readOnly: true });
  }
  putSettings(tenantId: string, companyId: string, input: PayrollSettingsInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      for (const [field, id] of Object.entries(input) as [PayrollAccount, string | null | undefined][]) {
        if (!id) continue;
        const [a] = await tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), eq(accounts.companyId, companyId), eq(accounts.id, id)));
        const rule = ACCOUNT_RULES[field];
        if (!a) throw validationFailed([{ path: field, message: 'This account does not exist in this company' }]);
        if (a.isGroup || a.status !== 'active' || a.type !== rule.type || !rule.controls.includes(a.controlKind)) throw validationFailed([{ path: field, message: `Must be ${rule.label}` }]);
      }
      const [existing] = await tx.select().from(payrollSettings).where(and(eq(payrollSettings.tenantId, tenantId), eq(payrollSettings.companyId, companyId))).for('update');
      const row = existing
        ? first(await tx.update(payrollSettings).set(input).where(and(eq(payrollSettings.tenantId, tenantId), eq(payrollSettings.companyId, companyId))).returning(), 'Payroll settings')
        : first(await tx.insert(payrollSettings).values({ tenantId, companyId, ...input }).returning(), 'Payroll settings');
      await this.recorder.record(tx, tenantId, 'payroll_settings', 'updated', { id: companyId }, { companyId, fields: Object.keys(input) });
      return row;
    });
  }
  async requireSettings(tx: Tx, tenantId: string, companyId: string, needs: PayrollAccount[]): Promise<PayrollSettingsRow> {
    const [row] = await tx.select().from(payrollSettings).where(and(eq(payrollSettings.tenantId, tenantId), eq(payrollSettings.companyId, companyId)));
    const missing = needs.filter((n) => !row || !row[n]);
    if (!row || missing.length > 0) throw new AppError(409, 'payroll_accounts_not_configured', `Set these in the company payroll settings first: ${missing.join(', ')}`, { missing });
    return row;
  }

  // ---- people ---------------------------------------------------------------------------------------------------------------------
  createEmployee(tenantId: string, input: CreateEmployeeInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      // Employee numbers do not depend on a fiscal year: one running sequence per company and kind (people are never deleted, so it has no gaps).
      const prefix = input.kind === 'employee' ? 'EMP' : 'CWK';
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`employee-no:${tenantId}:${input.companyId}:${prefix}`}, 0))`);
      const [count] = await tx.select({ n: sql<string>`COUNT(*)::text` }).from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.companyId, input.companyId), eq(employees.kind, input.kind)));
      const employeeNo = `${prefix}-${String(Number(count?.n ?? '0') + 1).padStart(6, '0')}`;
      const row = first(await tx.insert(employees).values({
        tenantId, id: uuidv7(), companyId: input.companyId, employeeNo, kind: input.kind, fullName: input.fullName, pan: input.pan ?? null, uan: input.uan ?? null, esiNo: input.esiNo ?? null, stateCode: input.stateCode, dateOfJoining: input.dateOfJoining,
        payBasis: input.payBasis, taxRegime: input.taxRegime, tdsRatePercent: input.tdsRatePercent ?? null, pfApplicable: input.pfApplicable, esiApplicable: input.esiApplicable, ptApplicable: input.ptApplicable, bankAccountRef: input.bankAccountRef ?? null,
      }).returning(), 'Employee');
      await this.recorder.record(tx, tenantId, 'employee', 'created', row, { employeeNo, kind: row.kind });
      return row;
    });
  }
  updateEmployee(tenantId: string, id: string, input: UpdateEmployeeInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const cur = first(await tx.select().from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.id, id))).for('update'), 'Employee');
      if (cur.status === 'exited') throw new AppError(409, 'employee_exited', 'This person has left');
      const row = first(await tx.update(employees).set(input).where(and(eq(employees.tenantId, tenantId), eq(employees.id, id))).returning(), 'Employee');
      await this.recorder.record(tx, tenantId, 'employee', 'updated', row, { fields: Object.keys(input) });
      return row;
    });
  }
  exitEmployee(tenantId: string, id: string, dateOfLeaving: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const cur = first(await tx.select().from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.id, id))).for('update'), 'Employee');
      if (cur.status === 'exited') throw new AppError(409, 'employee_exited', 'This person has already left');
      if (dateOfLeaving < cur.dateOfJoining) throw validationFailed([{ path: 'dateOfLeaving', message: 'Cannot be before the joining date' }]);
      const row = first(await tx.update(employees).set({ status: 'exited', dateOfLeaving }).where(and(eq(employees.tenantId, tenantId), eq(employees.id, id))).returning(), 'Employee');
      await this.recorder.record(tx, tenantId, 'employee', 'exited', row, { dateOfLeaving });
      return row;
    });
  }
  getEmployee(tenantId: string, id: string) { return this.uow.inTenant(tenantId, async (tx) => first(await tx.select().from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.id, id))), 'Employee'), { readOnly: true }); }
  listEmployees(tenantId: string, q: { companyId: string; limit: number; cursor?: string | undefined; kind?: string | undefined; status?: string | undefined }) {
    const before = decodeCursor(q.cursor);
    return this.uow.inTenant(tenantId, async (tx) => {
      const rows = await tx.select().from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.companyId, q.companyId), before ? lt(employees.id, before) : undefined, q.kind ? eq(employees.kind, q.kind) : undefined, q.status ? eq(employees.status, q.status) : undefined)).orderBy(desc(employees.id)).limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page.at(-1);
      return { items: page, nextCursor: rows.length > q.limit && last ? encodeCursor(last.id) : null };
    }, { readOnly: true });
  }

  // ---- components and structures ------------------------------------------------------------------------------------------------
  createComponent(tenantId: string, input: CreateComponentInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const row = first(await tx.insert(salaryComponents).values({ tenantId, id: uuidv7(), companyId: input.companyId, code: input.code, name: input.name, kind: input.kind, calculation: input.calculation, percent: input.percent ?? null, isTaxable: input.isTaxable, pfWage: input.pfWage, esiWage: input.esiWage }).returning(), 'Component');
      await this.recorder.record(tx, tenantId, 'salary_component', 'created', row, { code: row.code });
      return row;
    });
  }
  updateComponent(tenantId: string, id: string, input: { name?: string | undefined; status?: 'active' | 'inactive' | undefined }) {
    return this.uow.inTenant(tenantId, async (tx) => {
      first(await tx.select().from(salaryComponents).where(and(eq(salaryComponents.tenantId, tenantId), eq(salaryComponents.id, id))).for('update'), 'Component');
      const row = first(await tx.update(salaryComponents).set(input).where(and(eq(salaryComponents.tenantId, tenantId), eq(salaryComponents.id, id))).returning(), 'Component');
      await this.recorder.record(tx, tenantId, 'salary_component', 'updated', row, { fields: Object.keys(input) });
      return row;
    });
  }
  listComponents(tenantId: string, companyId: string) {
    return this.uow.inTenant(tenantId, (tx) => tx.select().from(salaryComponents).where(and(eq(salaryComponents.tenantId, tenantId), eq(salaryComponents.companyId, companyId))).orderBy(asc(salaryComponents.code)), { readOnly: true });
  }

  /** A new pay structure for a person, from a date. Structures are never edited: a revision is a new one. */
  createStructure(tenantId: string, actorId: string, employeeId: string, input: CreateStructureInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const emp = first(await tx.select().from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.id, employeeId))), 'Employee');
      if (emp.status === 'exited') throw new AppError(409, 'employee_exited', 'This person has left');
      if (input.effectiveFrom < emp.dateOfJoining) throw validationFailed([{ path: 'effectiveFrom', message: 'Cannot be before the joining date' }]);
      const ids = [...new Set(input.lines.map((l) => l.componentId))];
      if (ids.length !== input.lines.length) throw validationFailed([{ path: 'lines', message: 'A component appears twice' }]);
      const comps = ids.length > 0 ? await tx.select().from(salaryComponents).where(and(eq(salaryComponents.tenantId, tenantId), eq(salaryComponents.companyId, emp.companyId), inArray(salaryComponents.id, ids))) : [];
      input.lines.forEach((l, i) => {
        const c = comps.find((x) => x.id === l.componentId);
        if (!c || c.status !== 'active') throw validationFailed([{ path: `lines.${i}.componentId`, message: 'An active component of this company is needed' }]);
        if (c.calculation === 'fixed' && l.amount === undefined) throw validationFailed([{ path: `lines.${i}.amount`, message: `${c.code} is a fixed amount: give it` }]);
        if (c.calculation === 'percent_of_basic' && l.amount !== undefined) throw validationFailed([{ path: `lines.${i}.amount`, message: `${c.code} is a percent of basic: no amount` }]);
      });
      const s = first(await tx.insert(salaryStructures).values({ tenantId, id: uuidv7(), companyId: emp.companyId, employeeId, effectiveFrom: input.effectiveFrom, basic: input.basic, createdBy: actorId }).returning(), 'Salary structure');
      const lines = input.lines.length > 0 ? await tx.insert(salaryStructureLines).values(input.lines.map((l) => ({ tenantId, id: uuidv7(), structureId: s.id, componentId: l.componentId, amount: l.amount ?? null }))).returning() : [];
      await this.recorder.record(tx, tenantId, 'salary_structure', 'created', s, { employeeNo: emp.employeeNo, effectiveFrom: s.effectiveFrom, basic: s.basic });
      return { structure: s, lines };
    });
  }
  listStructures(tenantId: string, employeeId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const structures = await tx.select().from(salaryStructures).where(and(eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.employeeId, employeeId))).orderBy(desc(salaryStructures.effectiveFrom));
      const lines = structures.length > 0 ? await tx.select().from(salaryStructureLines).where(and(eq(salaryStructureLines.tenantId, tenantId), inArray(salaryStructureLines.structureId, structures.map((s) => s.id)))) : [];
      return structures.map((s) => ({ ...s, lines: lines.filter((l) => l.structureId === s.id) }));
    }, { readOnly: true });
  }
  /** The structure in force on a date (the latest one that started on or before it). */
  async structureOn(tx: Tx, tenantId: string, employeeId: string, date: string) {
    const [s] = await tx.select().from(salaryStructures).where(and(eq(salaryStructures.tenantId, tenantId), eq(salaryStructures.employeeId, employeeId), lte(salaryStructures.effectiveFrom, date))).orderBy(desc(salaryStructures.effectiveFrom)).limit(1);
    if (!s) return null;
    const lines = await tx.select({ line: salaryStructureLines, c: salaryComponents }).from(salaryStructureLines).innerJoin(salaryComponents, and(eq(salaryComponents.tenantId, salaryStructureLines.tenantId), eq(salaryComponents.id, salaryStructureLines.componentId))).where(and(eq(salaryStructureLines.tenantId, tenantId), eq(salaryStructureLines.structureId, s.id)));
    return { structure: s, lines };
  }

  // ---- monthly inputs ----------------------------------------------------------------------------------------------------------
  /** Attendance and one-offs for a person and month. Refused once a payroll run for that month has been posted. */
  putInput(tenantId: string, employeeId: string, period: string, input: PutInputInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const emp = first(await tx.select().from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.id, employeeId))), 'Employee');
      await this.assertOpenPeriod(tx, tenantId, emp.companyId, period);
      if (emp.payBasis !== 'monthly' && input.unitsWorked === undefined) throw validationFailed([{ path: 'unitsWorked', message: `Give the ${emp.payBasis === 'daily' ? 'days' : 'hours'} worked` }]);
      if (emp.payBasis === 'monthly' && input.unitsWorked !== undefined) throw validationFailed([{ path: 'unitsWorked', message: 'Units worked only apply to people paid by the day or hour' }]);
      const values = { lopDays: input.lopDays, unitsWorked: input.unitsWorked ?? null, bonus: input.bonus, otherDeduction: input.otherDeduction, notes: input.notes ?? null };
      const row = first(await tx.insert(payrollInputs).values({ tenantId, employeeId, period, ...values }).onConflictDoUpdate({ target: [payrollInputs.tenantId, payrollInputs.employeeId, payrollInputs.period], set: values }).returning(), 'Payroll input');
      await this.recorder.record(tx, tenantId, 'payroll_input', 'saved', { id: employeeId }, { period, employeeNo: emp.employeeNo });
      return row;
    });
  }
  listInputs(tenantId: string, companyId: string, period: string) {
    return this.uow.inTenant(tenantId, async (tx) => tx.select({ i: payrollInputs }).from(payrollInputs).innerJoin(employees, and(eq(employees.tenantId, payrollInputs.tenantId), eq(employees.id, payrollInputs.employeeId))).where(and(eq(payrollInputs.tenantId, tenantId), eq(employees.companyId, companyId), eq(payrollInputs.period, period))).then((r) => r.map((x) => x.i)), { readOnly: true });
  }
  /** Run services register a check here so inputs of a processed month cannot change. */
  private periodGuards: ((tx: Tx, tenantId: string, companyId: string, period: string) => Promise<void>)[] = [];
  onPeriodCheck(guard: (tx: Tx, tenantId: string, companyId: string, period: string) => Promise<void>): void { this.periodGuards.push(guard); }
  private async assertOpenPeriod(tx: Tx, tenantId: string, companyId: string, period: string): Promise<void> { for (const g of this.periodGuards) await g(tx, tenantId, companyId, period); }

  // ---- statutory rules ----------------------------------------------------------------------------------------------------------
  putRates(tenantId: string, input: PutRatesInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      for (const r of input.rates) {
        try { await tx.insert(payrollRates).values({ tenantId, id: uuidv7(), companyId: input.companyId, code: r.code, value: r.value, effectiveFrom: input.effectiveFrom }); } catch (error) { if ((error as { cause?: { code?: string } }).cause?.code === '23505' || (error as { code?: string }).code === '23505') throw new AppError(409, 'rate_exists', `${r.code} already has a rule from ${input.effectiveFrom}; rules are never edited: use a later date`); throw error; }
      }
      await this.recorder.record(tx, tenantId, 'payroll_rules', 'rates_set', { id: input.companyId }, { effectiveFrom: input.effectiveFrom, codes: input.rates.map((r) => r.code) });
      return { effectiveFrom: input.effectiveFrom, rates: input.rates };
    });
  }
  putSlabs(tenantId: string, input: PutSlabsInput) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const sorted = [...input.slabs].sort((a, b) => Number(a.from) - Number(b.from));
      sorted.forEach((s, i) => {
        if (s.to !== null && Number(s.to) <= Number(s.from)) throw validationFailed([{ path: 'slabs', message: 'A slab must end above where it starts' }]);
        const next = sorted[i + 1];
        if (next && (s.to === null || Number(s.to) > Number(next.from))) throw validationFailed([{ path: 'slabs', message: 'Slabs overlap' }]);
        if (!next && s.to !== null && input.kind !== 'pt') throw validationFailed([{ path: 'slabs', message: 'The last income-tax slab must be open-ended' }]);
      });
      try {
        await tx.insert(payrollSlabs).values(sorted.map((s) => ({ tenantId, id: uuidv7(), companyId: input.companyId, kind: input.kind, stateCode: input.stateCode ?? null, effectiveFrom: input.effectiveFrom, fromAmount: s.from, toAmount: s.to, ratePercent: s.ratePercent ?? null, fixedAmount: s.fixedAmount ?? null })));
      } catch (error) { if ((error as { cause?: { code?: string } }).cause?.code === '23505') throw new AppError(409, 'slabs_exist', `This slab set already has rules from ${input.effectiveFrom}; use a later date`); throw error; }
      await this.recorder.record(tx, tenantId, 'payroll_rules', 'slabs_set', { id: input.companyId }, { kind: input.kind, stateCode: input.stateCode, effectiveFrom: input.effectiveFrom, slabs: sorted.length });
      return { kind: input.kind, stateCode: input.stateCode ?? null, effectiveFrom: input.effectiveFrom, slabs: sorted };
    });
  }
  /** The statutory defaults for 2025-26 as a starting point (never overwrites a rule that already exists on that date). */
  seedDefaults(tenantId: string, companyId: string, effectiveFrom: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      for (const [code, value] of Object.entries(DEFAULT_RATES)) await tx.insert(payrollRates).values({ tenantId, id: uuidv7(), companyId, code, value, effectiveFrom }).onConflictDoNothing();
      const sets: { kind: string; state?: string; rows: { from: string; to: string | null; rate?: string; fixed?: string }[] }[] = [
        { kind: 'tds_new', rows: DEFAULT_TDS_NEW }, { kind: 'tds_old', rows: DEFAULT_TDS_OLD }, { kind: 'pt', state: '27', rows: DEFAULT_PT_MAHARASHTRA },
      ];
      for (const set of sets) await tx.insert(payrollSlabs).values(set.rows.map((r) => ({ tenantId, id: uuidv7(), companyId, kind: set.kind, stateCode: set.state ?? null, effectiveFrom, fromAmount: r.from, toAmount: r.to, ratePercent: set.kind === 'pt' ? null : (r.rate ?? null), fixedAmount: set.kind === 'pt' ? (r.fixed ?? null) : null }))).onConflictDoNothing();
      await this.recorder.record(tx, tenantId, 'payroll_rules', 'defaults_seeded', { id: companyId }, { effectiveFrom });
      return { effectiveFrom, rates: Object.keys(DEFAULT_RATES).length, slabSets: sets.map((s) => (s.state ? `${s.kind}:${s.state}` : s.kind)) };
    });
  }
  rulesOn(tenantId: string, companyId: string, date: string, stateCode: string | undefined) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const out = [];
      for (const regime of ['new', 'old'] as const) {
        const { rules, missing } = await resolveRules(tx, tenantId, companyId, date, regime, stateCode ?? '00');
        out.push({ regime, missing: missing.filter((m) => stateCode || !m.startsWith('pt')), tdsSlabs: rules.tdsSlabs.length, ptSlabs: rules.ptSlabs.length, standardDeduction: f4(rules.stdDeduction), rebateLimit: f4(rules.rebateLimit), rebateAmount: f4(rules.rebateAmount), cessPercent: f4(rules.cessPct) });
      }
      const { rules } = await resolveRules(tx, tenantId, companyId, date, 'new', stateCode ?? '00');
      return { date, stateCode: stateCode ?? null, pf: { employeePercent: f4(rules.pfEmployeePct), employerPercent: f4(rules.pfEmployerPct), ceiling: f4(rules.pfCeiling) }, esi: { employeePercent: f4(rules.esiEmployeePct), employerPercent: f4(rules.esiEmployerPct), ceiling: f4(rules.esiCeiling) }, regimes: out };
    }, { readOnly: true });
  }
}
