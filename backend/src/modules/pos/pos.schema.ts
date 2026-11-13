import { integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0012_pos.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const meta = { version: integer('version').notNull().default(1), createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow() };

export const posSettings = erp.table('pos_settings', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  walkInCustomerId: uuid('walk_in_customer_id'),
  cashVarianceAccountId: uuid('cash_variance_account_id'),
  ...meta,
});
export const posPaymentAccounts = erp.table('pos_payment_accounts', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  method: text('method').notNull(),
  accountId: uuid('account_id').notNull(),
  ...meta,
});
export const posTerminals = erp.table('pos_terminals', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  gstRegistrationId: uuid('gst_registration_id').notNull(),
  businessLocationId: uuid('business_location_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  status: text('status').notNull().default('active'),
  ...meta,
});
export const posShifts = erp.table('pos_shifts', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  terminalId: uuid('terminal_id').notNull(),
  shiftNo: text('shift_no').notNull(),
  openedBy: uuid('opened_by').notNull(),
  openedAt: ts('opened_at').notNull().defaultNow(),
  openingCash: money('opening_cash').notNull(),
  status: text('status').notNull().default('open'),
  closedBy: uuid('closed_by'),
  closedAt: ts('closed_at'),
  countedCash: money('counted_cash'),
  expectedCash: money('expected_cash'),
  variance: money('variance'),
  varianceEntryId: uuid('variance_entry_id'),
});
export const posSales = erp.table('pos_sales', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  shiftId: uuid('shift_id').notNull(),
  terminalId: uuid('terminal_id').notNull(),
  kind: text('kind').notNull(),
  documentId: uuid('document_id').notNull(),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
export const posPayments = erp.table('pos_payments', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  posSaleId: uuid('pos_sale_id').notNull(),
  method: text('method').notNull(),
  amount: money('amount').notNull(),
  tendered: money('tendered').notNull(),
  changeGiven: money('change_given').notNull().default('0'),
  reference: text('reference'),
  receiptId: uuid('receipt_id'),
  refundId: uuid('refund_id'),
});
