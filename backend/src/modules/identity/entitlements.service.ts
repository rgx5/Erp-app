import { Inject, Injectable } from '@nestjs/common';
import { createPublicKey, verify } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { UnitOfWork } from '../../platform/database/unit-of-work.js';
import { AppError, validationFailed } from '../../platform/http/errors.js';
import { AuditService } from '../../platform/services/audit.service.js';
import { LIMIT_KEYS, MODULES, moduleProblem } from './entitlements.js';
import { tenantEntitlements } from './identity.schema.js';
import { PrincipalCache } from './principal-cache.js';
import { tenants } from '../organization/organization.schema.js';

const iso = z.iso.datetime({ offset: true });
export const setEntitlementsSchema = z.strictObject({
  plan: z.string().trim().min(1).max(60).nullable().optional(),
  modules: z.array(z.enum(MODULES)).max(20),
  limits: z.partialRecord(z.enum(LIMIT_KEYS), z.number().int().min(0).max(1_000_000)).default({}),
  readOnly: z.boolean().default(false),
  expiresAt: iso.nullable().optional(),
  graceDays: z.number().int().min(0).max(365).default(14),
});
export type SetEntitlementsInput = z.infer<typeof setEntitlementsSchema>;

/** The licence a control plane signs: bound to one tenant, with an id and an issue time. */
export const licenceSchema = z.strictObject({
  licenceId: z.string().min(1).max(80),
  tenantId: z.uuid(),
  plan: z.string().trim().min(1).max(60).nullable().optional(),
  modules: z.array(z.enum(MODULES)).max(20),
  limits: z.partialRecord(z.enum(LIMIT_KEYS), z.number().int().min(0).max(1_000_000)).default({}),
  readOnly: z.boolean().default(false),
  expiresAt: iso.nullable().optional(),
  graceDays: z.number().int().min(0).max(365).default(14),
  issuedAt: iso,
});
export const signedLicenceSchema = z.strictObject({ licence: licenceSchema, signature: z.string().min(40).max(200) });
export type SignedLicence = z.infer<typeof signedLicenceSchema>;

/** Stable text for signing: object keys sorted at every level, so the same licence always signs to the same bytes. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function verifyLicence(signed: { licence: unknown; signature: string }, publicKeyPem: string): boolean {
  try {
    return verify(null, Buffer.from(canonical(signed.licence)), createPublicKey(publicKeyPem), Buffer.from(signed.signature, 'base64'));
  } catch {
    return false;
  }
}

/** Reads and writes what a tenant has licensed. Called by the platform only (control plane or, on a site, the licence import). */
@Injectable()
export class EntitlementsService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PrincipalCache) private readonly cache: PrincipalCache,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get(tenantId: string) {
    return this.uow.inTenant(tenantId, async (tx) => {
      const [t] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
      if (!t) throw new AppError(404, 'not_found', 'Tenant not found');
      const [row] = await tx.select().from(tenantEntitlements).where(eq(tenantEntitlements.tenantId, tenantId));
      return row ?? null;
    }, { readOnly: true });
  }

  set(tenantId: string, input: SetEntitlementsInput, source: 'platform' | 'licence' = 'platform', licenceId?: string) {
    const problem = moduleProblem(input.modules);
    if (problem) throw validationFailed([{ path: 'modules', message: problem }]);
    return this.uow.inTenant(tenantId, async (tx) => {
      const [t] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
      if (!t) throw new AppError(404, 'not_found', 'Tenant not found');
      const values = { plan: input.plan ?? null, modules: input.modules, limits: input.limits, readOnly: input.readOnly, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null, graceDays: input.graceDays, licenceId: licenceId ?? null, source, updatedAt: new Date() };
      const [row] = await tx.insert(tenantEntitlements).values({ tenantId, ...values }).onConflictDoUpdate({ target: tenantEntitlements.tenantId, set: { ...values } }).returning();
      await this.audit.record(tx, tenantId, { action: 'entitlements.set', entityType: 'entitlements', entityId: tenantId, details: { plan: values.plan, modules: input.modules, limits: input.limits, readOnly: input.readOnly, source, licenceId: licenceId ?? null } });
      this.cache.clearTenant(tenantId);
      return row as typeof tenantEntitlements.$inferSelect;
    });
  }

  /** Applies a signed licence. The signature must verify against the configured public key, and the licence must be for this tenant. */
  importLicence(tenantId: string, signed: SignedLicence) {
    const key = this.env.LICENCE_PUBLIC_KEY;
    if (!key) throw new AppError(409, 'licence_not_configured', 'This server has no licence public key, so signed licences cannot be imported');
    if (!verifyLicence(signed, key)) throw new AppError(422, 'licence_invalid', 'The licence signature is not valid');
    if (signed.licence.tenantId !== tenantId) throw new AppError(422, 'licence_wrong_tenant', 'This licence was issued for a different tenant');
    const { licenceId, issuedAt: _i, tenantId: _t, ...rest } = signed.licence;
    return this.set(tenantId, { ...rest, plan: rest.plan ?? null }, 'licence', licenceId);
  }
}
