import { date, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0054_loans.sql. */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const amt = (name: string) => numeric(name, { precision: 18, scale: 4 });
export const loans = erp.table('loans', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), companyId: uuid('company_id').notNull(), direction: text('direction').notNull(), loanNo: text('loan_no').notNull(), name: text('name').notNull(), partyId: uuid('party_id'),
  principal: amt('principal').notNull(), annualRate: numeric('annual_rate', { precision: 8, scale: 4 }).notNull().default('0'), method: text('method').notNull().default('reducing'), tenureMonths: integer('tenure_months').notNull(),
  disbursedOn: date('disbursed_on', { mode: 'string' }).notNull(), firstDueOn: date('first_due_on', { mode: 'string' }).notNull(), emi: amt('emi').notNull(), loanAccountId: uuid('loan_account_id').notNull(), interestAccountId: uuid('interest_account_id').notNull(),
  bankAccountId: uuid('bank_account_id').notNull(), disbursalEntryId: uuid('disbursal_entry_id'), status: text('status').notNull().default('active'), closedOn: date('closed_on', { mode: 'string' }), notes: text('notes'), createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const loanInstallments = erp.table('loan_installments', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), loanId: uuid('loan_id').notNull(), no: integer('no').notNull(), dueDate: date('due_date', { mode: 'string' }).notNull(), principal: amt('principal').notNull(), interest: amt('interest').notNull(),
  emi: amt('emi').notNull(), status: text('status').notNull().default('due'), paidOn: date('paid_on', { mode: 'string' }), paidAccountId: uuid('paid_account_id'), entryId: uuid('entry_id'),
});
