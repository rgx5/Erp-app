import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { unauthorized } from '../../platform/http/errors.js';
import { tenants } from '../organization/organization.schema.js';
import { apiKeys, roles, sessions, userRoles, users } from './identity.schema.js';
import type { Principal } from './principal.js';
import { TOKENS } from './crypto.providers.js';
import type { TokenService } from './tokens.js';

const UUID_HEX = /^[0-9a-f]{32}$/;
export const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();
export const compactUuid = (uuid: string): string => uuid.replaceAll('-', '');
export const expandUuid = (hex: string): string | undefined =>
  UUID_HEX.test(hex) ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : undefined;

/** Turns a bearer credential into the principal it stands for, re-checking the database on every request. */
@Injectable()
export class PrincipalService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(TOKENS) private readonly tokens: TokenService,
  ) {}

  async fromAccessToken(token: string): Promise<Principal> {
    const claims = this.tokens.verify(token);
    if (!claims) throw unauthorized('The access token is invalid or has expired');
    const principal = await this.uow.inTenant(
      claims.tid,
      async (tx) => {
        const [tenant] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, claims.tid));
        const [user] = await tx.select({ status: users.status }).from(users).where(and(eq(users.tenantId, claims.tid), eq(users.id, claims.sub)));
        // The session family stays alive until it is revoked (logout, password change, reuse detection).
        const alive = await tx
          .select({ one: sql<number>`1` })
          .from(sessions)
          .where(and(eq(sessions.tenantId, claims.tid), eq(sessions.familyId, claims.sid), eq(sessions.userId, claims.sub), isNull(sessions.revokedAt)))
          .limit(1);
        if (tenant?.status !== 'active' || user?.status !== 'active' || alive.length === 0) return undefined;
        return this.userPermissions(tx, claims.tid, claims.sub);
      },
      { readOnly: true },
    );
    if (!principal) throw unauthorized('The access token is invalid or has expired');
    return { tenantId: claims.tid, kind: 'user', userId: claims.sub, sessionId: claims.sid, permissions: principal };
  }

  async fromApiKey(key: string): Promise<Principal> {
    const fail = () => unauthorized('The API key is invalid, expired or revoked');
    const [prefix, tenantHex, keyHex, secret, extra] = key.split('_');
    if (prefix !== 'ek' || !tenantHex || !keyHex || !secret || extra !== undefined) throw fail();
    const tenantId = expandUuid(tenantHex);
    const keyId = expandUuid(keyHex);
    if (!tenantId || !keyId) throw fail();
    const found = await this.uow.inTenant(
      tenantId,
      async (tx) => {
        const [tenant] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
        const [row] = await tx.select().from(apiKeys).where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, keyId)));
        return tenant?.status === 'active' ? row : undefined;
      },
      { readOnly: true },
    );
    const presented = sha256(secret);
    // Compare even when the key is unknown, so the response time does not reveal which key ids exist.
    const matches = timingSafeEqual(presented, found?.secretHash ?? Buffer.alloc(32));
    if (!found || !matches || found.revokedAt || (found.expiresAt && found.expiresAt.getTime() <= Date.now())) throw fail();
    // Record last use at most every 5 minutes: a write per request would make every API call a write transaction.
    if (!found.lastUsedAt || Date.now() - found.lastUsedAt.getTime() > 300_000) {
      await this.uow
        .inTenant(tenantId, (tx) => tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, keyId))))
        .catch(() => undefined); // bookkeeping must never fail a request
    }
    return { tenantId, kind: 'api_key', userId: found.createdBy, apiKeyId: found.id, permissions: new Set(found.permissions) };
  }

  /** The union of the permissions of the user's active role assignments. */
  async userPermissions(tx: Tx, tenantId: string, userId: string): Promise<Set<string>> {
    const rows = await tx
      .select({ permissions: roles.permissions })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)))
      .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, userId), isNull(userRoles.revokedAt)));
    return new Set(rows.flatMap((r) => r.permissions));
  }
}
