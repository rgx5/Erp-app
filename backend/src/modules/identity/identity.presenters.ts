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
