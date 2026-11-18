import { date, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0030_expenses.sql (the SQL is the source of truth). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const expenseCategories = erp.table('expense_categories', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  expenseAccountId: uuid('expense_account_id').notNull(),
  status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const expenseVouchers = erp.table('expense_vouchers', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  voucherNo: text('voucher_no').notNull(),
  voucherDate: date('voucher_date', { mode: 'string' }).notNull(),
  categoryId: uuid('category_id').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  paidFromAccountId: uuid('paid_from_account_id').notNull(),
  payee: text('payee'),
  note: text('note'),
  journalEntryId: uuid('journal_entry_id').notNull(),
  status: text('status').notNull().default('posted'),
  cancelledAt: ts('cancelled_at'),
  cancelReason: text('cancel_reason'),
  cancelJournalId: uuid('cancel_journal_id'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
