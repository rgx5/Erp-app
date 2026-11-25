import { boolean, date, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0048_tds.sql. */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const tdsSections = erp.table('tds_sections', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), code: text('code').notNull(), description: text('description').notNull(), rate: numeric('rate', { precision: 7, scale: 4 }).notNull(),
  singleLimit: numeric('single_limit', { precision: 18, scale: 2 }).notNull().default('0'), annualLimit: numeric('annual_limit', { precision: 18, scale: 2 }).notNull().default('0'), status: text('status').notNull().default('active'),
});
export const tdsDeductions = erp.table('tds_deductions', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), companyId: uuid('company_id').notNull(), supplierId: uuid('supplier_id').notNull(), paymentId: uuid('payment_id').notNull(), sectionCode: text('section_code').notNull(),
  rate: numeric('rate', { precision: 7, scale: 4 }).notNull(), baseAmount: numeric('base_amount', { precision: 18, scale: 2 }).notNull(), tdsAmount: numeric('tds_amount', { precision: 18, scale: 2 }).notNull(), pan: text('pan'), noPanRate: boolean('no_pan_rate').notNull().default(false),
  deductedOn: date('deducted_on', { mode: 'string' }).notNull(), status: text('status').notNull().default('deducted'), depositJournalId: uuid('deposit_journal_id'), challanNo: text('challan_no'), challanDate: date('challan_date', { mode: 'string' }), bsrCode: text('bsr_code'), depositedOn: date('deposited_on', { mode: 'string' }),
  createdBy: uuid('created_by'), createdAt: ts('created_at').notNull().defaultNow(),
});
