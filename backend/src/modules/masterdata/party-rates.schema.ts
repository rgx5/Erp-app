import { boolean, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0052_party_item_rates.sql. */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const partyItemRates = erp.table('party_item_rates', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), partyId: uuid('party_id').notNull(), itemId: uuid('item_id').notNull(), rate: numeric('rate', { precision: 18, scale: 4 }).notNull(),
  taxInclusive: boolean('tax_inclusive').notNull().default(false), status: text('status').notNull().default('active'), createdBy: uuid('created_by'), createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
});
