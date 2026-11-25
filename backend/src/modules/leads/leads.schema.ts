import { boolean, integer, jsonb, numeric, pgSchema, text, timestamp, uuid, bigint, date } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0046_leads.sql. */
const erp = pgSchema('erp');
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const leadSettings = erp.table('lead_settings', {
  tenantId: uuid('tenant_id').notNull(), assignmentMode: text('assignment_mode').notNull().default('manual'), members: uuid('members').array().notNull().default([]), rules: jsonb('rules').notNull().default([]), territories: jsonb('territories').notNull().default([]),
  slaMinutes: integer('sla_minutes').notNull().default(30), rrCursor: integer('rr_cursor').notNull().default(0), leadSeq: bigint('lead_seq', { mode: 'number' }).notNull().default(0), lostReasons: text('lost_reasons').array().notNull(), updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const leadStages = erp.table('lead_stages', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), name: text('name').notNull(), position: integer('position').notNull(), kind: text('kind').notNull().default('open'), status: text('status').notNull().default('active'),
});
export const leadConnectors = erp.table('lead_connectors', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), kind: text('kind').notNull(), name: text('name').notNull(), status: text('status').notNull().default('active'), publicId: text('public_id').notNull(),
  config: jsonb('config').notNull().default({}), secretSealed: text('secret_sealed'), leadCount: integer('lead_count').notNull().default(0), lastLeadAt: ts('last_lead_at'), lastError: text('last_error'), createdBy: uuid('created_by'), createdAt: ts('created_at').notNull().defaultNow(),
});
export const leadIngestKeys = erp.table('lead_ingest_keys', { publicId: text('public_id').notNull(), tenantId: uuid('tenant_id').notNull(), connectorId: uuid('connector_id').notNull() });
export const leads = erp.table('leads', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), leadNo: text('lead_no').notNull(), name: text('name').notNull(), phone: text('phone'), phoneNorm: text('phone_norm'), email: text('email'),
  city: text('city'), pincode: text('pincode'), state: text('state'), source: text('source').notNull().default('manual'), connectorId: uuid('connector_id'), externalId: text('external_id'),
  campaign: text('campaign'), adset: text('adset'), ad: text('ad'), formName: text('form_name'), utm: jsonb('utm').notNull().default({}), clickId: text('click_id'),
  stageId: uuid('stage_id').notNull(), status: text('status').notNull().default('open'), lostReason: text('lost_reason'), ownerId: uuid('owner_id'), assignedAt: ts('assigned_at'),
  firstResponseAt: ts('first_response_at'), slaDueAt: ts('sla_due_at'), nextFollowUpAt: ts('next_follow_up_at'), interest: text('interest'), valueEstimate: numeric('value_estimate', { precision: 18, scale: 2 }),
  fields: jsonb('fields').notNull().default({}), consent: boolean('consent').notNull().default(false), consentAt: ts('consent_at'), enquiryCount: integer('enquiry_count').notNull().default(1),
  partyId: uuid('party_id'), convertedAt: ts('converted_at'), duplicateOf: uuid('duplicate_of'), raw: jsonb('raw'), createdBy: uuid('created_by'), createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const leadActivities = erp.table('lead_activities', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), leadId: uuid('lead_id').notNull(), kind: text('kind').notNull(), body: text('body').notNull().default(''), dueAt: ts('due_at'), doneAt: ts('done_at'), createdBy: uuid('created_by'), createdAt: ts('created_at').notNull().defaultNow(),
});
export const leadAdSpend = erp.table('lead_ad_spend', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), spendDate: date('spend_date', { mode: 'string' }).notNull(), source: text('source').notNull(), campaign: text('campaign').notNull().default(''), amount: numeric('amount', { precision: 18, scale: 2 }).notNull(),
  impressions: integer('impressions'), clicks: integer('clicks'), note: text('note'), createdBy: uuid('created_by'), createdAt: ts('created_at').notNull().defaultNow(),
});
export const leadDeliveries = erp.table('lead_deliveries', {
  tenantId: uuid('tenant_id').notNull(), id: uuid('id').notNull(), connectorId: uuid('connector_id').notNull(), outcome: text('outcome').notNull(), detail: text('detail'), externalId: text('external_id'), createdAt: ts('created_at').notNull().defaultNow(),
});
