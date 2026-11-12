import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { unauthorized } from '../../platform/http/errors.js';
import { tenants } from '../organization/organization.schema.js';
import { apiKeys } from './identity.schema.js';
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
    // One round trip: tenant status, user status, live session and the union of role permissions. (Every extra query here is
    // paid by every authenticated request.)
    const principal = await this.uow.inTenant(
      claims.tid,
      async (tx) => {
        const result = await tx.execute<{ tenant_status: string; user_status: string | null; session_alive: boolean; permissions: string[] }>(sql`
          SELECT t.status AS tenant_status,
                 u.status AS user_status,
                 EXISTS (SELECT 1 FROM erp.sessions s
                          WHERE s.tenant_id = ${claims.tid}::uuid AND s.family_id = ${claims.sid}::uuid AND s.user_id = ${claims.sub}::uuid AND s.revoked_at IS NULL) AS session_alive,
                 COALESCE((SELECT array_agg(DISTINCT p) FROM erp.user_roles ur
                             JOIN erp.roles r ON r.tenant_id = ur.tenant_id AND r.id = ur.role_id
                             CROSS JOIN LATERAL unnest(r.permissions) AS p
                            WHERE ur.tenant_id = ${claims.tid}::uuid AND ur.user_id = ${claims.sub}::uuid AND ur.revoked_at IS NULL), '{}') AS permissions
            FROM erp.tenants t
            LEFT JOIN erp.users u ON u.tenant_id = t.id AND u.id = ${claims.sub}::uuid
           WHERE t.id = ${claims.tid}::uuid`);
        const row = result.rows[0];
        return row && row.tenant_status === 'active' && row.user_status === 'active' && row.session_alive ? new Set(row.permissions) : undefined;
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
}
