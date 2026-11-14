import { boolean, char, date, integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0023_payroll_masters.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const pctCol = (name: string) => numeric(name, { precision: 7, scale: 4 });

export const payrollSettings = erp.table('payroll_settings', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  salaryExpenseAccountId: uuid('salary_expense_account_id'),
  employerCostAccountId: uuid('employer_cost_account_id'),
  salaryPayableAccountId: uuid('salary_payable_account_id'),
  pfPayableAccountId: uuid('pf_payable_account_id'),
  esiPayableAccountId: uuid('esi_payable_account_id'),
  ptPayableAccountId: uuid('pt_payable_account_id'),
  tdsPayableAccountId: uuid('tds_payable_account_id'),
  otherDeductionsAccountId: uuid('other_deductions_account_id'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const employees = erp.table('employees', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  employeeNo: text('employee_no').notNull(),
  kind: text('kind').notNull(),
  fullName: text('full_name').notNull(),
  pan: text('pan'),
  uan: text('uan'),
  esiNo: text('esi_no'),
  stateCode: char('state_code', { length: 2 }).notNull(),
  dateOfJoining: day('date_of_joining').notNull(),
  dateOfLeaving: day('date_of_leaving'),
  payBasis: text('pay_basis').notNull().default('monthly'),
  taxRegime: text('tax_regime').notNull().default('new'),
  tdsRatePercent: pctCol('tds_rate_percent'),
  pfApplicable: boolean('pf_applicable').notNull().default(false),
  esiApplicable: boolean('esi_applicable').notNull().default(false),
  ptApplicable: boolean('pt_applicable').notNull().default(false),
  bankAccountRef: text('bank_account_ref'),
  status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const salaryComponents = erp.table('salary_components', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  calculation: text('calculation').notNull(),
  percent: pctCol('percent'),
  isTaxable: boolean('is_taxable').notNull().default(true),
  pfWage: boolean('pf_wage').notNull().default(false),
  esiWage: boolean('esi_wage').notNull().default(false),
  status: text('status').notNull().default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const salaryStructures = erp.table('salary_structures', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  effectiveFrom: day('effective_from').notNull(),
  basic: money('basic').notNull(),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const salaryStructureLines = erp.table('salary_structure_lines', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  structureId: uuid('structure_id').notNull(),
  componentId: uuid('component_id').notNull(),
  amount: money('amount'),
});

export const payrollInputs = erp.table('payroll_inputs', {
  tenantId: uuid('tenant_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  period: text('period').notNull(),
  lopDays: numeric('lop_days', { precision: 6, scale: 2 }).notNull().default('0'),
  unitsWorked: numeric('units_worked', { precision: 10, scale: 2 }),
  bonus: money('bonus').notNull().default('0'),
  otherDeduction: money('other_deduction').notNull().default('0'),
  notes: text('notes'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const payrollRates = erp.table('payroll_rates', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  value: numeric('value', { precision: 18, scale: 6 }).notNull(),
  effectiveFrom: day('effective_from').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const payrollSlabs = erp.table('payroll_slabs', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  kind: text('kind').notNull(),
  stateCode: char('state_code', { length: 2 }),
  effectiveFrom: day('effective_from').notNull(),
  fromAmount: money('from_amount').notNull(),
  toAmount: money('to_amount'),
  ratePercent: pctCol('rate_percent'),
  fixedAmount: money('fixed_amount'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const payrollRuns = erp.table('payroll_runs', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  runNo: text('run_no').notNull(),
  period: text('period').notNull(),
  payDate: day('pay_date').notNull(),
  grossTotal: money('gross_total').notNull(),
  employeeDeductions: money('employee_deductions').notNull(),
  netTotal: money('net_total').notNull(),
  employerCostTotal: money('employer_cost_total').notNull(),
  pfTotal: money('pf_total').notNull().default('0'),
  esiTotal: money('esi_total').notNull().default('0'),
  ptTotal: money('pt_total').notNull().default('0'),
  tdsTotal: money('tds_total').notNull().default('0'),
  journalEntryId: uuid('journal_entry_id'),
  status: text('status').notNull().default('posted'),
  paidOn: day('paid_on'),
  paymentJournalId: uuid('payment_journal_id'),
  cancelledAt: ts('cancelled_at'),
  cancelReason: text('cancel_reason'),
  cancelJournalId: uuid('cancel_journal_id'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const payslips = erp.table('payslips', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  runId: uuid('run_id').notNull(),
  employeeId: uuid('employee_id').notNull(),
  employeeNo: text('employee_no').notNull(),
  employeeName: text('employee_name').notNull(),
  kind: text('kind').notNull(),
  period: text('period').notNull(),
  gross: money('gross').notNull(),
  pfEmployee: money('pf_employee').notNull().default('0'),
  pfEmployer: money('pf_employer').notNull().default('0'),
  esiEmployee: money('esi_employee').notNull().default('0'),
  esiEmployer: money('esi_employer').notNull().default('0'),
  professionalTax: money('professional_tax').notNull().default('0'),
  tds: money('tds').notNull().default('0'),
  otherDeductions: money('other_deductions').notNull().default('0'),
  net: money('net').notNull(),
  detail: jsonb('detail').notNull(),
});

export const statutoryRemittances = erp.table('statutory_remittances', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  remittanceNo: text('remittance_no').notNull(),
  kind: text('kind').notNull(),
  period: text('period').notNull(),
  remittedOn: day('remitted_on').notNull(),
  amount: money('amount').notNull(),
  reference: text('reference'),
  journalEntryId: uuid('journal_entry_id').notNull(),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
