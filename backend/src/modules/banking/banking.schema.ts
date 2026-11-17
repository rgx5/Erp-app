import { date, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0028_bank_reconciliation.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });

export const bankAccounts = erp.table('bank_accounts', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  accountId: uuid('account_id').notNull(),
  name: text('name').notNull(),
  bankName: text('bank_name'),
  accountRef: text('account_ref'),
  clearedThrough: day('cleared_through'),
  status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const bankStatements = erp.table('bank_statements', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  bankAccountId: uuid('bank_account_id').notNull(),
  statementNo: text('statement_no').notNull(),
  periodFrom: day('period_from').notNull(),
  periodTo: day('period_to').notNull(),
  openingBalance: money('opening_balance').notNull(),
  closingBalance: money('closing_balance').notNull(),
  lineCount: integer('line_count').notNull(),
  contentHash: text('content_hash').notNull(),
  status: text('status').notNull().default('active'),
  voidedReason: text('voided_reason'),
  importedBy: uuid('imported_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const bankStatementLines = erp.table('bank_statement_lines', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  statementId: uuid('statement_id').notNull(),
  companyId: uuid('company_id').notNull(),
  bankAccountId: uuid('bank_account_id').notNull(),
  lineNo: integer('line_no').notNull(),
  lineDate: day('line_date').notNull(),
  description: text('description').notNull(),
  reference: text('reference'),
  amount: money('amount').notNull(),
  balance: money('balance'),
  status: text('status').notNull().default('unmatched'),
  ignoreReason: text('ignore_reason'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const bankMatches = erp.table('bank_matches', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  statementLineId: uuid('statement_line_id').notNull(),
  journalLineId: uuid('journal_line_id').notNull(),
  amount: money('amount').notNull(),
  matchedBy: uuid('matched_by'),
  matchedAt: ts('matched_at').notNull().defaultNow(),
  endedAt: ts('ended_at'),
  endedBy: uuid('ended_by'),
  endReason: text('end_reason'),
});
