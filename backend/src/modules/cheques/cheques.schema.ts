import { date, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0053_cheques.sql. */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const cheques = erp.table('cheques', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), companyId: uuid('company_id').notNull(), direction: text('direction').notNull(), partyId: uuid('party_id').notNull(), chequeNo: text('cheque_no').notNull(),
  chequeDate: date('cheque_date', { mode: 'string' }).notNull(), bankName: text('bank_name'), amount: numeric('amount', { precision: 18, scale: 4 }).notNull(), status: text('status').notNull().default('pending'), accountId: uuid('account_id'),
  allocations: jsonb('allocations').notNull().default([]), notes: text('notes'), depositedOn: date('deposited_on', { mode: 'string' }), clearedOn: date('cleared_on', { mode: 'string' }), bouncedOn: date('bounced_on', { mode: 'string' }), bounceReason: text('bounce_reason'),
  receiptId: uuid('receipt_id'), paymentId: uuid('payment_id'), createdBy: uuid('created_by'), createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
});
