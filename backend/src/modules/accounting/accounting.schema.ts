import { sql } from 'drizzle-orm';
import { bigint, boolean, date, integer, numeric, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0006_accounting.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const meta = {
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const accounts = erp.table('accounts', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  parentId: uuid('parent_id'),
  isGroup: boolean('is_group').notNull().default(false),
  controlKind: text('control_kind'),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const fiscalYears = erp.table('fiscal_years', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  label: text('label').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const accountingPeriods = erp.table('accounting_periods', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  fiscalYearId: uuid('fiscal_year_id').notNull(),
  periodNo: smallint('period_no').notNull(),
  name: text('name').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  status: text('status').notNull().default('open'),
  closedAt: ts('closed_at'),
  lockedAt: ts('locked_at'),
  ...meta,
});

export const journalCounters = erp.table('journal_counters', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  fiscalYearId: uuid('fiscal_year_id').notNull(),
  journalType: text('journal_type').notNull(),
  nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
});

export const journalEntries = erp.table('journal_entries', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  fiscalYearId: uuid('fiscal_year_id').notNull(),
  periodId: uuid('period_id').notNull(),
  entryNo: text('entry_no').notNull(),
  journalType: text('journal_type').notNull(),
  sourceType: text('source_type').notNull().default('manual'),
  sourceId: text('source_id'),
  sourceEvent: text('source_event').notNull().default('post'),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  description: text('description').notNull(),
  totalDebit: money('total_debit').notNull(),
  totalCredit: money('total_credit').notNull(),
  lineCount: integer('line_count').notNull(),
  reversesEntryId: uuid('reverses_entry_id'),
  reversalReason: text('reversal_reason'),
  postedBy: uuid('posted_by'),
  postedAt: ts('posted_at').notNull().defaultNow(),
  txId: bigint('tx_id', { mode: 'number' }).notNull().default(sql`txid_current()`),
});

export const journalLines = erp.table('journal_lines', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  entryId: uuid('entry_id').notNull(),
  companyId: uuid('company_id').notNull(),
  lineNo: integer('line_no').notNull(),
  accountId: uuid('account_id').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  debit: money('debit').notNull().default('0'),
  credit: money('credit').notNull().default('0'),
  description: text('description'),
  businessLocationId: uuid('business_location_id'),
  partyId: uuid('party_id'),
  txId: bigint('tx_id', { mode: 'number' }).notNull().default(sql`txid_current()`),
});

export const accountingSettings = erp.table('accounting_settings', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  retainedEarningsAccountId: uuid('retained_earnings_account_id'),
  ...meta,
});

export const statementMappings = erp.table('statement_mappings', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  accountId: uuid('account_id').notNull(),
  lineCode: text('line_code').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const fiscalYearClosings = erp.table('fiscal_year_closings', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  fiscalYearId: uuid('fiscal_year_id').notNull(),
  closingEntryId: uuid('closing_entry_id'),
  netProfit: money('net_profit').notNull(),
  status: text('status').notNull().default('closed'),
  closedBy: uuid('closed_by'),
  closedAt: ts('closed_at').notNull().defaultNow(),
  reopenedBy: uuid('reopened_by'),
  reopenedAt: ts('reopened_at'),
  reopenReason: text('reopen_reason'),
});
