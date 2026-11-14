import { integer, numeric, pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0022_gst_returns.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const gstReturnSettings = erp.table('gst_return_settings', {
  tenantId: uuid('tenant_id').notNull(),
  companyId: uuid('company_id').notNull(),
  gstRegistrationId: uuid('gst_registration_id').notNull(),
  compositionRate: numeric('composition_rate', { precision: 7, scale: 4 }),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
