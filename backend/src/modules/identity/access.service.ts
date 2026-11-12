import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { Tx } from '../../platform/database/database.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, notFound, preconditionFailed, validationFailed } from '../../platform/http/errors.js';
import { decodeCursor, type Page, toPage } from '../../platform/http/validation.js';
import { AuditService } from '../../platform/services/audit.service.js';
import { OutboxService } from '../../platform/services/outbox.service.js';
import { seedTenantDefaults } from '../masterdata/seed.js';
import { tenants } from '../organization/organization.schema.js';
import { apiKeys, roles, sessions, userRoles, users } from './identity.schema.js';
import type { CreateApiKeyInput, CreateRoleInput, CreateUserInput, ProvisionTenantInput, UpdateRoleInput, UpdateUserInput } from './identity.schemas.js';
import { hashPassword } from './password.js';
import { allows, OWNER_ROLE_NAME, WILDCARD } from './permissions.js';
import type { Principal } from './principal.js';
import { compactUuid, sha256 } from './principal.service.js';

export type UserRow = typeof users.$inferSelect;
export type RoleRow = typeof roles.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type UserWithRoles = UserRow & { roleIds: string[] };

const one = <T>(rows: T[], what: string): T => {
  const row = rows[0];
  if (!row) throw notFound(what);
  return row;
};

/** Nobody may hand out more than they hold: a user, role or key can never exceed the grantor's own permissions. */
function assertCanGrant(actor: Principal, permissions: readonly string[]): void {
  if (permissions.includes(WILDCARD) ? !actor.permissions.has(WILDCARD) : !allows(actor.permissions, permissions)) {
    throw new AppError(403, 'privilege_escalation', 'You cannot grant permissions you do not hold yourself');
  }
}

/** Tenant provisioning, users, roles and API keys. */
@Injectable()
export class AccessService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  /** Audit entry + domain event, in the caller's transaction. */
  private async note(tx: Tx, tenantId: string, entity: string, verb: string, id: string, details: Record<string, unknown> = {}, publish = true): Promise<void> {
    await this.audit.record(tx, tenantId, { action: `${entity}.${verb}`, entityType: entity, entityId: id, details });
    if (publish) await this.outbox.publish(tx, tenantId, { eventType: `${entity}.${verb}`, aggregateType: entity, aggregateId: id, payload: { id, ...details } });
  }

  // ---- provisioning ---------------------------------------------------------------------------------------------

  /** Creates a tenant with its built-in Owner role and first owner, atomically, in the new tenant's own context. */
  async provisionTenant(input: ProvisionTenantInput) {
    const tenantId = uuidv7();
    const passwordHash = await hashPassword(input.owner.password);
    return this.uow.inTenant(tenantId, async (tx) => {
      const [tenant] = await tx.insert(tenants).values({ id: tenantId, slug: input.slug, name: input.name }).returning();
      const roleId = uuidv7();
      await tx.insert(roles).values({ tenantId, id: roleId, name: OWNER_ROLE_NAME, description: 'Full access', isSystem: true, permissions: [WILDCARD] });
      const userId = uuidv7();
      const [user] = await tx
        .insert(users)
        .values({ tenantId, id: userId, email: input.owner.email, displayName: input.owner.displayName, passwordHash })
        .returning();
      await tx.insert(userRoles).values({ tenantId, userId, roleId, grantedBy: userId });
      await seedTenantDefaults(tx, tenantId);
      if (!tenant || !user) throw new Error('provisioning returned no rows');
      await this.note(tx, tenantId, 'tenant', 'provisioned', tenantId, { slug: tenant.slug, ownerUserId: user.id });
      return { tenant, user };
    });
  }

  // ---- users ----------------------------------------------------------------------------------------------------

  async createUser(actor: Principal, input: CreateUserInput): Promise<UserWithRoles> {
    const passwordHash = await hashPassword(input.password);
    return this.uow.inTenant(actor.tenantId, async (tx) => {
      const granted = await this.loadRoles(tx, actor.tenantId, input.roleIds);
      for (const role of granted) assertCanGrant(actor, role.permissions);
      const [user] = await tx
        .insert(users)
        .values({ tenantId: actor.tenantId, id: uuidv7(), email: input.email, displayName: input.displayName, passwordHash })
        .returning();
      if (!user) throw new Error('insert returned no row');
      if (granted.length > 0) {
        await tx.insert(userRoles).values(granted.map((r) => ({ tenantId: actor.tenantId, userId: user.id, roleId: r.id, grantedBy: actor.userId })));
      }
      await this.note(tx, actor.tenantId, 'user', 'created', user.id, { email: user.email, roleIds: granted.map((r) => r.id) });
      return { ...user, roleIds: granted.map((r) => r.id) };
    });
  }

  getUser(tenantId: string, id: string): Promise<UserWithRoles> {
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const user = one(await tx.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, id))), 'User');
        return (await this.withRoles(tx, tenantId, [user]))[0] as UserWithRoles;
      },
      { readOnly: true },
    );
  }

  listUsers(tenantId: string, limit: number, cursor: string | undefined): Promise<Page<UserWithRoles>> {
    const after = decodeCursor(cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => {
        const rows = await tx
          .select()
          .from(users)
          .where(and(eq(users.tenantId, tenantId), after ? gt(users.id, after) : undefined))
          .orderBy(asc(users.id))
          .limit(limit + 1);
        const page = toPage(rows, limit);
        return { items: await this.withRoles(tx, tenantId, page.items), nextCursor: page.nextCursor };
      },
      { readOnly: true },
    );
  }

  updateUser(actor: Principal, id: string, version: number, input: UpdateUserInput): Promise<UserWithRoles> {
    return this.uow.inTenant(actor.tenantId, async (tx) => {
      if (input.status === 'disabled') {
        if (id === actor.userId) throw new AppError(409, 'cannot_disable_self', 'You cannot disable your own account');
        await this.assertOwnerRemains(tx, actor.tenantId, id);
      }
      const updated = await tx
        .update(users)
        .set({ ...(input.displayName !== undefined ? { displayName: input.displayName } : {}), ...(input.status !== undefined ? { status: input.status } : {}) })
        .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, id), eq(users.version, version)))
        .returning();
      if (updated.length === 0) {
        const [exists] = await tx.select({ id: users.id }).from(users).where(and(eq(users.tenantId, actor.tenantId), eq(users.id, id)));
        throw exists ? preconditionFailed('The user changed since you read it; fetch it again') : notFound('User');
      }
      if (input.status === 'disabled') {
        await tx
          .update(sessions)
          .set({ revokedAt: new Date(), revokedReason: 'user_disabled' })
          .where(and(eq(sessions.tenantId, actor.tenantId), eq(sessions.userId, id), isNull(sessions.revokedAt)));
      }
      await this.note(tx, actor.tenantId, 'user', input.status === 'disabled' ? 'disabled' : 'updated', id, { fields: Object.keys(input), ...(input.status ? { status: input.status } : {}) });
      return (await this.withRoles(tx, actor.tenantId, updated))[0] as UserWithRoles;
    });
  }

  /** Replaces the user's role set. Removed roles are revoked (timestamped), never deleted. */
  setUserRoles(actor: Principal, userId: string, roleIds: string[]): Promise<UserWithRoles> {
    return this.uow.inTenant(actor.tenantId, async (tx) => {
      const user = one(await tx.select().from(users).where(and(eq(users.tenantId, actor.tenantId), eq(users.id, userId))).for('update'), 'User');
      const wanted = await this.loadRoles(tx, actor.tenantId, roleIds);
      for (const role of wanted) assertCanGrant(actor, role.permissions);
      const wantedIds = new Set(wanted.map((r) => r.id));
      const current = await tx
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(and(eq(userRoles.tenantId, actor.tenantId), eq(userRoles.userId, userId), isNull(userRoles.revokedAt)));
      const removed = current.map((c) => c.roleId).filter((r) => !wantedIds.has(r));
      if (removed.length > 0) {
        const removedRoles = await this.loadRoles(tx, actor.tenantId, removed);
        for (const role of removedRoles) assertCanGrant(actor, role.permissions); // you cannot strip a role you could not grant
        await tx
          .update(userRoles)
          .set({ revokedAt: new Date() })
          .where(and(eq(userRoles.tenantId, actor.tenantId), eq(userRoles.userId, userId), inArray(userRoles.roleId, removed), isNull(userRoles.revokedAt)));
        await this.assertOwnerRemains(tx, actor.tenantId, userId, true);
      }
      for (const role of wanted) {
        await tx
          .insert(userRoles)
          .values({ tenantId: actor.tenantId, userId, roleId: role.id, grantedBy: actor.userId })
          .onConflictDoUpdate({
            target: [userRoles.tenantId, userRoles.userId, userRoles.roleId],
            set: { revokedAt: null, grantedBy: actor.userId, grantedAt: new Date() },
            setWhere: sql`${userRoles.revokedAt} is not null`,
          });
      }
      await this.note(tx, actor.tenantId, 'user', 'roles_changed', userId, { granted: wanted.map((r) => r.id).filter((r) => !current.some((c) => c.roleId === r)), revoked: removed });
      return (await this.withRoles(tx, actor.tenantId, [user]))[0] as UserWithRoles;
    });
  }

  // ---- roles ----------------------------------------------------------------------------------------------------

  createRole(actor: Principal, input: CreateRoleInput): Promise<RoleRow> {
    assertCanGrant(actor, input.permissions);
    return this.uow.inTenant(actor.tenantId, async (tx) => {
      const role = one(await tx.insert(roles).values({ tenantId: actor.tenantId, id: uuidv7(), name: input.name, description: input.description ?? null, permissions: input.permissions }).returning(), 'Role');
      await this.note(tx, actor.tenantId, 'role', 'created', role.id, { name: role.name, permissions: role.permissions });
      return role;
    });
  }

  getRole(tenantId: string, id: string): Promise<RoleRow> {
    return this.uow.inTenant(tenantId, async (tx) => one(await tx.select().from(roles).where(and(eq(roles.tenantId, tenantId), eq(roles.id, id))), 'Role'), { readOnly: true });
  }

  listRoles(tenantId: string, limit: number, cursor: string | undefined): Promise<Page<RoleRow>> {
    const after = decodeCursor(cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => toPage(await tx.select().from(roles).where(and(eq(roles.tenantId, tenantId), after ? gt(roles.id, after) : undefined)).orderBy(asc(roles.id)).limit(limit + 1), limit),
      { readOnly: true },
    );
  }

  updateRole(actor: Principal, id: string, version: number, input: UpdateRoleInput): Promise<RoleRow> {
    if (input.permissions) assertCanGrant(actor, input.permissions);
    return this.uow.inTenant(actor.tenantId, async (tx) => {
      const [existing] = await tx.select().from(roles).where(and(eq(roles.tenantId, actor.tenantId), eq(roles.id, id)));
      if (!existing) throw notFound('Role');
      if (existing.isSystem) throw new AppError(409, 'system_role_immutable', 'Built-in roles cannot be changed');
      assertCanGrant(actor, existing.permissions); // you cannot edit a role that is more powerful than you
      const updated = await tx
        .update(roles)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.permissions !== undefined ? { permissions: input.permissions } : {}),
        })
        .where(and(eq(roles.tenantId, actor.tenantId), eq(roles.id, id), eq(roles.version, version)))
        .returning();
      const role = updated[0];
      if (!role) throw preconditionFailed('The role changed since you read it; fetch it again');
      await this.note(tx, actor.tenantId, 'role', 'updated', id, { fields: Object.keys(input), ...(input.permissions ? { permissions: input.permissions } : {}) });
      return role;
    });
  }

  // ---- API keys -------------------------------------------------------------------------------------------------

  /** The full key is returned once and never stored; only its SHA-256 is kept. */
  async createApiKey(actor: Principal, input: CreateApiKeyInput): Promise<{ key: string; record: ApiKeyRow }> {
    assertCanGrant(actor, input.permissions);
    if (input.expiresAt && new Date(input.expiresAt).getTime() <= Date.now()) throw validationFailed([{ path: 'expiresAt', message: 'Must be in the future' }]);
    const id = uuidv7();
    const secret = randomBytes(32).toString('hex');
    const key = `ek_${compactUuid(actor.tenantId)}_${compactUuid(id)}_${secret}`;
    const record = await this.uow.inTenant(actor.tenantId, async (tx) => {
      const created = one(
        await tx
          .insert(apiKeys)
          .values({
            tenantId: actor.tenantId,
            id,
            name: input.name,
            keyPrefix: `ek_${compactUuid(id).slice(-8)}`,
            secretHash: sha256(secret),
            permissions: input.permissions,
            createdBy: actor.userId,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          })
          .returning(),
        'API key',
      );
      // The key itself is never written anywhere: only its prefix and permissions.
      await this.note(tx, actor.tenantId, 'api_key', 'created', created.id, { name: created.name, keyPrefix: created.keyPrefix, permissions: created.permissions }, false);
      return created;
    });
    return { key, record };
  }

  listApiKeys(tenantId: string, limit: number, cursor: string | undefined): Promise<Page<ApiKeyRow>> {
    const after = decodeCursor(cursor);
    return this.uow.inTenant(
      tenantId,
      async (tx) => toPage(await tx.select().from(apiKeys).where(and(eq(apiKeys.tenantId, tenantId), after ? gt(apiKeys.id, after) : undefined)).orderBy(asc(apiKeys.id)).limit(limit + 1), limit),
      { readOnly: true },
    );
  }

  revokeApiKey(tenantId: string, id: string): Promise<ApiKeyRow> {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [row] = await tx.select().from(apiKeys).where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, id)));
      if (!row) throw notFound('API key');
      if (row.revokedAt) return row; // revoking twice is harmless
      const revoked = one(await tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, id))).returning(), 'API key');
      await this.note(tx, tenantId, 'api_key', 'revoked', id, { keyPrefix: revoked.keyPrefix }, false);
      return revoked;
    });
  }

  // ---- internals ------------------------------------------------------------------------------------------------

  private async loadRoles(tx: Tx, tenantId: string, ids: string[]): Promise<RoleRow[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const found = await tx.select().from(roles).where(and(eq(roles.tenantId, tenantId), inArray(roles.id, unique)));
    const missing = unique.filter((id) => !found.some((r) => r.id === id));
    if (missing.length > 0) throw validationFailed(missing.map((id) => ({ path: 'roleIds', message: `Role ${id} does not exist` })));
    return found;
  }

  private async withRoles(tx: Tx, tenantId: string, rows: UserRow[]): Promise<UserWithRoles[]> {
    if (rows.length === 0) return [];
    const assigned = await tx
      .select({ userId: userRoles.userId, roleId: userRoles.roleId })
      .from(userRoles)
      .where(and(eq(userRoles.tenantId, tenantId), inArray(userRoles.userId, rows.map((r) => r.id)), isNull(userRoles.revokedAt)));
    return rows.map((row) => ({ ...row, roleIds: assigned.filter((a) => a.userId === row.id).map((a) => a.roleId) }));
  }

  /**
   * A tenant must always keep at least one active user holding the built-in Owner role. Call AFTER the change is applied in
   * the same transaction (`applied = true`), or BEFORE it for a status change (`applied = false`, `userId` is the one leaving).
   */
  private async assertOwnerRemains(tx: Tx, tenantId: string, leavingUserId: string, applied = false): Promise<void> {
    const owners = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.tenantId, userRoles.tenantId), eq(roles.id, userRoles.roleId)))
      .innerJoin(users, and(eq(users.tenantId, userRoles.tenantId), eq(users.id, userRoles.userId)))
      .where(and(eq(userRoles.tenantId, tenantId), isNull(userRoles.revokedAt), eq(roles.isSystem, true), eq(users.status, 'active')));
    const remaining = owners.filter((o) => applied || o.userId !== leavingUserId);
    if (remaining.length === 0) throw new AppError(409, 'last_owner', 'The tenant must keep at least one active owner');
  }
}
