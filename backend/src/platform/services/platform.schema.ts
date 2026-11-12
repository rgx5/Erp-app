import { bigint, boolean, customType, integer, jsonb, pgSchema, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0004_platform_services.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const meta = {
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const auditLog = erp.table('audit_log', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  outcome: text('outcome').notNull().default('success'),
  requestId: text('request_id'),
  ipAddress: text('ip_address'),
  details: jsonb('details').notNull().default({}),
});

export const idempotencyKeys = erp.table('idempotency_keys', {
  tenantId: uuid('tenant_id').notNull(),
  key: text('key').notNull(),
  fingerprint: bytea('fingerprint').notNull(),
  actorId: uuid('actor_id'),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
});

export const outboxEvents = erp.table('outbox_events', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  eventType: text('event_type').notNull(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: text('aggregate_id').notNull(),
  payload: jsonb('payload').notNull(),
  requestId: text('request_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const outboxConsumed = erp.table('outbox_consumed', {
  tenantId: uuid('tenant_id').notNull(),
  eventId: uuid('event_id').notNull(),
  consumer: text('consumer').notNull(),
  consumedAt: ts('consumed_at').notNull().defaultNow(),
});

export const outboxDispatch = erp.table('outbox_dispatch', {
  eventId: uuid('event_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  availableAt: ts('available_at').notNull().defaultNow(),
  attempts: integer('attempts').notNull().default(0),
  lockedUntil: ts('locked_until'),
  doneAt: ts('done_at'),
  deadAt: ts('dead_at'),
  lastError: text('last_error'),
});

export const numberSeries = erp.table('number_series', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  gstRegistrationId: uuid('gst_registration_id').notNull(),
  documentType: text('document_type').notNull(),
  financialYear: text('financial_year').notNull(),
  prefix: text('prefix').notNull(),
  separator: text('separator').notNull().default('/'),
  includeFinancialYear: boolean('include_financial_year').notNull().default(true),
  padding: smallint('padding').notNull().default(5),
  nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
  status: text('status').notNull().default('active'),
  ...meta,
});

export const numberAllocations = erp.table('number_allocations', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  seriesId: uuid('series_id').notNull(),
  value: bigint('value', { mode: 'number' }).notNull(),
  formatted: text('formatted').notNull(),
  documentRef: text('document_ref'),
  status: text('status').notNull().default('issued'),
  cancelReason: text('cancel_reason'),
  allocatedAt: ts('allocated_at').notNull().defaultNow(),
  cancelledAt: ts('cancelled_at'),
});
