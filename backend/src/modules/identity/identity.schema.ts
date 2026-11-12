import { bigint, boolean, customType, integer, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors db/migrations/0003_identity.sql (the SQL is the source of truth; a test compares the columns). */
const erp = pgSchema('erp');
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const meta = {
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const tenantDirectory = erp.table('tenant_directory', {
  slug: text('slug').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
});

export const users = erp.table('users', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  status: text('status').notNull().default('active'),
  mfaEnabled: boolean('mfa_enabled').notNull().default(false),
  mfaSecretEnc: text('mfa_secret_enc'),
  mfaLastStep: bigint('mfa_last_step', { mode: 'number' }),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  lastLoginAt: ts('last_login_at'),
  passwordChangedAt: ts('password_changed_at').notNull().defaultNow(),
  ...meta,
});

export const roles = erp.table('roles', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  permissions: text('permissions').array().notNull().default([]),
  ...meta,
});

export const userRoles = erp.table('user_roles', {
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  roleId: uuid('role_id').notNull(),
  grantedBy: uuid('granted_by'),
  grantedAt: ts('granted_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
});

export const sessions = erp.table('sessions', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  familyId: uuid('family_id').notNull(),
  userId: uuid('user_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  revokedAt: ts('revoked_at'),
  revokedReason: text('revoked_reason'),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const apiKeys = erp.table('api_keys', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  secretHash: bytea('secret_hash').notNull(),
  permissions: text('permissions').array().notNull().default([]),
  createdBy: uuid('created_by').notNull(),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  lastUsedAt: ts('last_used_at'),
  ...meta,
});

export const mfaRecoveryCodes = erp.table('mfa_recovery_codes', {
  tenantId: uuid('tenant_id').notNull(),
  id: uuid('id').notNull(),
  userId: uuid('user_id').notNull(),
  codeHash: bytea('code_hash').notNull(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
