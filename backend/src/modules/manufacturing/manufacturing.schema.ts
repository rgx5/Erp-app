import { date, integer, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0018_manufacturing_masters.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });
const quantity = (name: string) => numeric(name, { precision: 18, scale: 6 });

export const workCentres = erp.table('work_centres', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  labourRatePerHour: money('labour_rate_per_hour').notNull().default('0'),
  machineRatePerHour: money('machine_rate_per_hour').notNull().default('0'),
  overheadRatePerHour: money('overhead_rate_per_hour').notNull().default('0'),
  status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const boms = erp.table('boms', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  itemId: uuid('item_id').notNull(),
  bomNo: text('bom_no').notNull(),
  version: integer('version').notNull(),
  description: text('description'),
  baseQuantity: quantity('base_quantity').notNull().default('1'),
  effectiveFrom: day('effective_from').notNull(),
  effectiveTo: day('effective_to'),
  status: text('status').notNull().default('active'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const bomLines = erp.table('bom_lines', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  bomId: uuid('bom_id').notNull(),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id').notNull(),
  quantity: quantity('quantity').notNull(),
  scrapPercent: numeric('scrap_percent', { precision: 7, scale: 4 }).notNull().default('0'),
  notes: text('notes'),
});

export const bomOperations = erp.table('bom_operations', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  bomId: uuid('bom_id').notNull(),
  opNo: integer('op_no').notNull(),
  name: text('name').notNull(),
  workCentreId: uuid('work_centre_id').notNull(),
  setupHours: numeric('setup_hours', { precision: 12, scale: 4 }).notNull().default('0'),
  runHours: numeric('run_hours', { precision: 12, scale: 4 }).notNull().default('0'),
});
