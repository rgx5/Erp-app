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

/** Mirrors db/migrations/0031_customer_wallet.sql. */
export const retailSettings = erp.table('retail_settings', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  loyaltyPointsPerHundred: numeric('loyalty_points_per_hundred', { precision: 10, scale: 4 }).notNull().default('0'),
  loyaltyRupeesPerPoint: numeric('loyalty_rupees_per_point', { precision: 10, scale: 4 }).notNull().default('0'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const loyaltyLedger = erp.table('loyalty_ledger', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  customerId: uuid('customer_id').notNull(),
  points: numeric('points', { precision: 18, scale: 2 }).notNull(),
  kind: text('kind').notNull(),
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  note: text('note'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const coupons = erp.table('coupons', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  description: text('description'),
  kind: text('kind').notNull(),
  value: numeric('value', { precision: 18, scale: 4 }).notNull(),
  minBill: numeric('min_bill', { precision: 18, scale: 4 }).notNull().default('0'),
  maxDiscount: numeric('max_discount', { precision: 18, scale: 4 }),
  validFrom: date('valid_from', { mode: 'string' }),
  validTo: date('valid_to', { mode: 'string' }),
  maxUses: integer('max_uses'),
  usedCount: integer('used_count').notNull().default(0),
  status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const couponRedemptions = erp.table('coupon_redemptions', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  couponId: uuid('coupon_id').notNull(),
  posSaleId: uuid('pos_sale_id').notNull(),
  customerId: uuid('customer_id'),
  billTotal: numeric('bill_total', { precision: 18, scale: 4 }).notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const posWalletUses = erp.table('pos_wallet_uses', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  posSaleId: uuid('pos_sale_id').notNull(),
  kind: text('kind').notNull(),
  amount: numeric('amount', { precision: 18, scale: 4 }).notNull(),
  points: numeric('points', { precision: 18, scale: 2 }),
  reference: text('reference'),
});
