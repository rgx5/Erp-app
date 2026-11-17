import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import type { Principal } from './principal.js';

interface Entry { principal: Principal; expiresAt: number }
const MAX_ENTRIES = 20_000;

/**
 * An optional, short-lived, in-process cache of authenticated principals. Authentication costs database round trips on every request;
 * with `AUTH_PRINCIPAL_CACHE_TTL_MS` > 0 a credential that was valid a moment ago is trusted for that long. The cost is that a
 * revocation done directly in the database (outside this API) takes up to the TTL to be noticed; revocations made through the API
 * clear the tenant's entries at once. Off (0) by default. It is per process: with several instances, the TTL is the bound.
 */
@Injectable()
export class PrincipalCache {
  private readonly entries = new Map<string, Entry>();
  private readonly byTenant = new Map<string, Set<string>>();
  private readonly ttl: number;

  constructor(@Inject(ENV) env: Env) { this.ttl = env.AUTH_PRINCIPAL_CACHE_TTL_MS; }

  get enabled(): boolean { return this.ttl > 0; }
  /** The cache key never holds the credential itself, only its hash. */
  keyOf(credential: string): string { return createHash('sha256').update(credential).digest('base64url'); }

  get(key: string): Principal | undefined {
    if (!this.enabled) return undefined;
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) { this.entries.delete(key); return undefined; }
    return e.principal;
  }

  set(key: string, principal: Principal): void {
    if (!this.enabled) return;
    if (this.entries.size >= MAX_ENTRIES) { this.entries.clear(); this.byTenant.clear(); }
    this.entries.set(key, { principal, expiresAt: Date.now() + this.ttl });
    const set = this.byTenant.get(principal.tenantId) ?? new Set<string>();
    set.add(key);
    this.byTenant.set(principal.tenantId, set);
  }

  /** Forgets everyone in a tenant (a role, user, key or session changed). */
  clearTenant(tenantId: string): void {
    const keys = this.byTenant.get(tenantId);
    if (!keys) return;
    for (const k of keys) this.entries.delete(k);
    this.byTenant.delete(tenantId);
  }
}
