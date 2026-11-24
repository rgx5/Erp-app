import { customType, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0042_attachments.sql. The file bytes are read and written with SQL (the column is bytea). */
const erp = pgSchema('erp');
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
export const attachments = erp.table('attachments', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  kind: text('kind').notNull().default('file'),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  data: bytea('data').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});
