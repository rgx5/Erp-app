import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const money = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A non-negative decimal with at most 4 places, as a string');
const positive = money.refine((v) => Number(v) > 0, 'Must be greater than zero');
const percent = z.string().regex(/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/, 'A percentage from 0 to 100, as a string');
const period = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'A month as YYYY-MM');
const state = z.string().regex(/^[0-9]{2}$/, 'A 2-digit GST state code');
const account = z.uuid().nullable().optional();
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };

export const payrollSettingsSchema = z
  .strictObject({ salaryExpenseAccountId: account, employerCostAccountId: account, salaryPayableAccountId: account, pfPayableAccountId: account, esiPayableAccountId: account, ptPayableAccountId: account, tdsPayableAccountId: account, otherDeductionsAccountId: account })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export type PayrollSettingsInput = z.infer<typeof payrollSettingsSchema>;

const personFields = {
  fullName: text(120),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'A PAN such as ABCDE1234F').optional(),
  uan: text(20).optional(),
  esiNo: text(20).optional(),
  /** The state the person works in (decides professional tax). */
  stateCode: state,
  payBasis: z.enum(['monthly', 'daily', 'hourly']).default('monthly'),
  taxRegime: z.enum(['new', 'old']).default('new'),
  /** Contract workers: the flat TDS rate on what they are paid. */
  tdsRatePercent: percent.optional(),
  pfApplicable: z.boolean().default(false),
  esiApplicable: z.boolean().default(false),
  ptApplicable: z.boolean().default(false),
  bankAccountRef: text(60).optional(),
};
export const createEmployeeSchema = z
  .strictObject({ companyId: z.uuid(), kind: z.enum(['employee', 'contract_worker']).default('employee'), dateOfJoining: isoDate, ...personFields })
  .refine((v) => v.kind === 'employee' || v.payBasis !== 'monthly' || v.tdsRatePercent !== undefined, { path: ['tdsRatePercent'], message: 'A contract worker needs a TDS rate (use 0 for none)' });
export const updateEmployeeSchema = z
  .strictObject({
    fullName: text(120).optional(), pan: personFields.pan, uan: personFields.uan, esiNo: personFields.esiNo, stateCode: state.optional(), payBasis: z.enum(['monthly', 'daily', 'hourly']).optional(),
    taxRegime: z.enum(['new', 'old']).optional(), tdsRatePercent: percent.optional(), pfApplicable: z.boolean().optional(), esiApplicable: z.boolean().optional(), ptApplicable: z.boolean().optional(), bankAccountRef: personFields.bankAccountRef,
  })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export const exitEmployeeSchema = z.strictObject({ dateOfLeaving: isoDate });
export const listEmployeesQuery = z.object({ ...page, companyId: z.uuid(), kind: z.enum(['employee', 'contract_worker']).optional(), status: z.enum(['active', 'exited']).optional() });

export const createComponentSchema = z
  .strictObject({
    companyId: z.uuid(),
    code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{0,19}$/),
    name: text(120),
    kind: z.enum(['earning', 'deduction']),
    calculation: z.enum(['fixed', 'percent_of_basic']),
    percent: percent.optional(),
    isTaxable: z.boolean().default(true),
    pfWage: z.boolean().default(false),
    esiWage: z.boolean().default(false),
  })
  .refine((v) => (v.calculation === 'percent_of_basic') === (v.percent !== undefined && Number(v.percent) > 0), { path: ['percent'], message: 'Give a percent for percent_of_basic components, and only for them' })
  .refine((v) => v.kind === 'earning' || (!v.pfWage && !v.esiWage), { path: ['kind'], message: 'A deduction cannot be PF or ESI wages' });
export const updateComponentSchema = z.strictObject({ name: text(120).optional(), status: z.enum(['active', 'inactive']).optional() }).refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export const listComponentsQuery = z.object({ companyId: z.uuid() });

export const createStructureSchema = z.strictObject({
  effectiveFrom: isoDate,
  /** Monthly basic, or the rate per day / hour for workers paid by the day or hour. */
  basic: positive,
  lines: z.array(z.strictObject({ componentId: z.uuid(), amount: money.optional() })).max(50).default([]),
});

export const putInputSchema = z.strictObject({ lopDays: z.string().regex(/^[0-9]{1,2}(\.[0-9]{1,2})?$/).default('0'), unitsWorked: z.string().regex(/^[0-9]{1,8}(\.[0-9]{1,2})?$/).optional(), bonus: money.default('0'), otherDeduction: money.default('0'), notes: text(300).optional() });
export const inputsQuery = z.object({ companyId: z.uuid(), period });

export const putRatesSchema = z.strictObject({
  companyId: z.uuid(),
  effectiveFrom: isoDate,
  rates: z.array(z.strictObject({ code: z.enum(['pf_employee_percent', 'pf_employer_percent', 'pf_wage_ceiling', 'esi_employee_percent', 'esi_employer_percent', 'esi_wage_ceiling', 'tds_std_deduction_new', 'tds_std_deduction_old', 'tds_rebate_limit_new', 'tds_rebate_amount_new', 'tds_rebate_limit_old', 'tds_rebate_amount_old', 'tds_cess_percent']), value: money })).min(1).max(20),
});
export const putSlabsSchema = z
  .strictObject({
    companyId: z.uuid(),
    kind: z.enum(['tds_new', 'tds_old', 'pt']),
    stateCode: state.optional(),
    effectiveFrom: isoDate,
    slabs: z.array(z.strictObject({ from: money, to: money.nullable(), ratePercent: percent.optional(), fixedAmount: money.optional() })).min(1).max(30),
  })
  .refine((v) => (v.kind === 'pt') === (v.stateCode !== undefined), { path: ['stateCode'], message: 'Professional-tax slabs need a state; income-tax slabs must not have one' })
  .refine((v) => v.slabs.every((s) => (v.kind === 'pt' ? s.fixedAmount !== undefined && s.ratePercent === undefined : s.ratePercent !== undefined && s.fixedAmount === undefined)), { path: ['slabs'], message: 'Professional tax takes fixedAmount per slab; income tax takes ratePercent' });
export const rulesQuery = z.object({ companyId: z.uuid(), date: isoDate, stateCode: state.optional() });
export const seedQuery = z.object({ companyId: z.uuid(), effectiveFrom: isoDate });

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type CreateComponentInput = z.infer<typeof createComponentSchema>;
export type CreateStructureInput = z.infer<typeof createStructureSchema>;
export type PutInputInput = z.infer<typeof putInputSchema>;
export type PutRatesInput = z.infer<typeof putRatesSchema>;
export type PutSlabsInput = z.infer<typeof putSlabsSchema>;

// ---- runs --------------------------------------------------------------------------------------------------------------------------
export const createRunSchema = z.strictObject({ companyId: z.uuid(), period, payDate: isoDate });
export const payRunSchema = z.strictObject({ date: isoDate, paidFromAccountId: z.uuid() });
export const cancelRunSchema = z.strictObject({ date: isoDate, reason: text(300) });
export const remitSchema = z.strictObject({ companyId: z.uuid(), kind: z.enum(['pf', 'esi', 'pt', 'tds']), period, date: isoDate, amount: positive, paidFromAccountId: z.uuid(), reference: text(100).optional() });
export const listRunsQuery = z.object({ ...page, companyId: z.uuid(), status: z.enum(['posted', 'paid', 'cancelled']).optional() });
export const liabilitiesQuery = z.object({ companyId: z.uuid() });
export type CreateRunInput = z.infer<typeof createRunSchema>;
export type RemitInput = z.infer<typeof remitSchema>;
