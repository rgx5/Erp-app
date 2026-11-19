import type { ApiKeyRow, RoleRow, UserWithRoles } from './access.service.js';
import type { TokenPair } from './auth.service.js';

const meta = (row: { version: number; createdAt: Date; updatedAt: Date }) => ({
  version: row.version,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Never includes the password hash, MFA secret or lockout internals. */
export const presentUser = (u: Omit<UserWithRoles, 'roleIds'> & { roleIds?: string[] }) => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  status: u.status,
  mfaEnabled: u.mfaEnabled,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  ...(u.roleIds ? { roleIds: u.roleIds } : {}),
  ...meta(u),
});

export const presentRole = (r: RoleRow) => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem, permissions: r.permissions, ...meta(r) });

export const presentApiKey = (k: ApiKeyRow) => ({
  id: k.id,
  name: k.name,
  keyPrefix: k.keyPrefix,
  permissions: k.permissions,
  createdBy: k.createdBy,
  expiresAt: k.expiresAt?.toISOString() ?? null,
  revokedAt: k.revokedAt?.toISOString() ?? null,
  lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
  ...meta(k),
});

export const presentSession = (user: Parameters<typeof presentUser>[0], tokens: TokenPair) => ({ ...tokens, user: presentUser(user) });

import type { Entitlements } from './entitlements.js';
import { daysLeft, writesBlocked } from './entitlements.js';
import type { tenantEntitlements } from './identity.schema.js';

/** A stored licence as the platform sees it. */
export const presentEntitlements = (row: typeof tenantEntitlements.$inferSelect) => ({
  plan: row.plan, modules: [...row.modules].sort(), limits: row.limits, readOnly: row.readOnly, expiresAt: row.expiresAt?.toISOString() ?? null, graceDays: row.graceDays, licenceId: row.licenceId, source: row.source, updatedAt: row.updatedAt.toISOString(),
});
/** What a signed-in client needs to know: which modules to show, the limits, whether the system is read-only, and a warning before expiry. */
export const presentMyEntitlements = (e: Entitlements | undefined) => {
  if (!e || !e.restricted) return { restricted: false, plan: null, modules: [] as string[], limits: {}, readOnly: false, readOnlyReason: null, expiresAt: null, daysLeft: null };
  return { restricted: true, plan: e.plan, modules: [...e.modules].sort(), limits: e.limits, readOnly: writesBlocked(e) !== undefined, readOnlyReason: writesBlocked(e) ?? null, expiresAt: e.expiresAt?.toISOString() ?? null, daysLeft: daysLeft(e) };
};
