import { char, date, integer, pgSchema, smallint, text, timestamp, uuid, boolean } from 'drizzle-orm/pg-core';

/**
 * Mirrors db/migrations/0002_tenancy.sql. The SQL is the source of truth (it carries RLS, triggers and CHECKs that an
 * ORM cannot express); a test fails if these definitions and the real columns ever diverge.
 */
export const erp = pgSchema('erp');

const audit = {
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
};

export const tenants = erp.table('tenants', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  ...audit,
});

export const companies = erp.table('companies', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  pan: text('pan'),
  baseCurrency: char('base_currency', { length: 3 }).notNull().default('INR'),
  fiscalYearStartMonth: smallint('fiscal_year_start_month').notNull().default(4),
  status: text('status').notNull().default('active'),
  ...audit,
});

export const gstRegistrations = erp.table('gst_registrations', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  gstin: char('gstin', { length: 15 }).notNull(),
  stateCode: char('state_code', { length: 2 }).notNull(),
  legalName: text('legal_name').notNull(),
  tradeName: text('trade_name'),
  registrationType: text('registration_type').notNull().default('regular'),
  status: text('status').notNull().default('active'),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  effectiveTo: date('effective_to', { mode: 'string' }),
  ...audit,
});

export const businessLocations = erp.table('business_locations', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  gstRegistrationId: uuid('gst_registration_id'),
  code: text('code').notNull(),
  name: text('name').notNull(),
  isPrincipalPlace: boolean('is_principal_place').notNull().default(false),
  addressLine1: text('address_line1').notNull(),
  addressLine2: text('address_line2'),
  city: text('city').notNull(),
  stateCode: char('state_code', { length: 2 }).notNull(),
  pincode: char('pincode', { length: 6 }).notNull(),
  status: text('status').notNull().default('active'),
  ...audit,
});

export const warehouses = erp.table('warehouses', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  businessLocationId: uuid('business_location_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('general'),
  status: text('status').notNull().default('active'),
  ...audit,
});
