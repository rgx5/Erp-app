import { integer, jsonb, numeric, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0027_approvals.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 18, scale: 4 });

export const approvalPolicies = erp.table('approval_policies', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  documentType: text('document_type').notNull(),
  thresholdAmount: money('threshold_amount').notNull(),
  requiredApprovals: integer('required_approvals').notNull(),
  validDays: integer('valid_days').notNull().default(7),
  status: text('status').notNull().default('active'),
  version: integer('version').notNull().default(1),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const approvalRequests = erp.table('approval_requests', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  companyId: uuid('company_id').notNull(),
  requestNo: text('request_no').notNull(),
  documentType: text('document_type').notNull(),
  amount: money('amount').notNull(),
  summary: text('summary').notNull(),
  payload: jsonb('payload').notNull(),
  payloadHash: text('payload_hash').notNull(),
  requiredApprovals: integer('required_approvals').notNull(),
  validDays: integer('valid_days').notNull(),
  approvalsCount: integer('approvals_count').notNull().default(0),
  status: text('status').notNull().default('pending'),
  requestedBy: uuid('requested_by').notNull(),
  requestedAt: ts('requested_at').notNull().defaultNow(),
  decidedAt: ts('decided_at'),
  validUntil: ts('valid_until'),
  consumedAt: ts('consumed_at'),
  consumedBy: uuid('consumed_by'),
  consumedRefType: text('consumed_ref_type'),
  consumedRefId: uuid('consumed_ref_id'),
});

export const approvalDecisions = erp.table('approval_decisions', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  requestId: uuid('request_id').notNull(),
  decision: text('decision').notNull(),
  decidedBy: uuid('decided_by').notNull(),
  comment: text('comment'),
  decidedAt: ts('decided_at').notNull().defaultNow(),
});
