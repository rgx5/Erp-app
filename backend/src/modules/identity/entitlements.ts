import { SetMetadata } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../platform/database/database.js';
import { AppError } from '../../platform/http/errors.js';

/** The sellable areas of the product. Core (sign-in, users, organisation, master data, the ledger engine, audit) is always on and not listed. */
export const MODULES = ['sales', 'purchasing', 'inventory', 'pos', 'accounting', 'gst', 'banking', 'approvals', 'manufacturing', 'payroll', 'extras'] as const;
export type ModuleName = (typeof MODULES)[number];
/** A module that needs others to be on as well. */
export const DEPENDS: Readonly<Record<string, readonly ModuleName[]>> = {
  pos: ['sales', 'inventory'], gst: ['sales', 'accounting'], banking: ['accounting'], manufacturing: ['inventory'], payroll: ['accounting'],
};
/** The numeric limits a licence may set (a missing limit means no limit). */
export const LIMIT_KEYS = ['users', 'companies', 'locations', 'terminals'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export interface Entitlements {
  /** False when the tenant has no licence record: everything is allowed (existing tenants, development). */
  restricted: boolean;
  plan: string | null;
  modules: ReadonlySet<string>;
  limits: Readonly<Partial<Record<LimitKey, number>>>;
  readOnly: boolean;
  expiresAt: Date | null;
  graceDays: number;
}
export const UNRESTRICTED: Entitlements = { restricted: false, plan: null, modules: new Set(), limits: {}, readOnly: false, expiresAt: null, graceDays: 0 };

/** Adds what a module needs, so licensing Payroll also licenses Accounting rather than leaving a module that cannot work. */
export function withDependencies(modules: readonly string[]): string[] {
  const out = new Set(modules);
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of out) for (const d of DEPENDS[m] ?? []) if (!out.has(d)) { out.add(d); changed = true; }
  }
  return [...out].sort();
}
/** The first problem with a set of modules, or undefined. */
export function moduleProblem(modules: readonly string[]): string | undefined {
  const unknown = modules.filter((m) => !(MODULES as readonly string[]).includes(m));
  if (unknown.length) return `Unknown module: ${unknown.join(', ')}`;
  for (const m of modules) for (const d of DEPENDS[m] ?? []) if (!modules.includes(d)) return `${m} needs ${d}`;
  return undefined;
}

interface Row { plan?: string | null; modules?: string[]; limits?: Record<string, number>; read_only?: boolean; expires_at?: string | null; grace_days?: number }
export function fromRow(row: Row | null | undefined): Entitlements {
  if (!row) return UNRESTRICTED;
  return { restricted: true, plan: row.plan ?? null, modules: new Set(row.modules ?? []), limits: row.limits ?? {}, readOnly: row.read_only === true, expiresAt: row.expires_at ? new Date(row.expires_at) : null, graceDays: row.grace_days ?? 14 };
}

/** Allowed for this module? Core routes (no module) and unrestricted tenants always are. Any one of the listed modules is enough. */
export const entitled = (e: Entitlements | undefined, modules: readonly string[]): boolean => !e || !e.restricted || modules.length === 0 || modules.some((m) => e.modules.has(m));
/** Writes are refused when the licence says so, or once it has expired and its grace period has ended. */
export function writesBlocked(e: Entitlements | undefined, now = new Date()): 'suspended' | 'expired' | undefined {
  if (!e || !e.restricted) return undefined;
  if (e.readOnly) return 'suspended';
  if (e.expiresAt && now.getTime() > e.expiresAt.getTime() + e.graceDays * 86_400_000) return 'expired';
  return undefined;
}
/** Days until expiry (negative once past), or null when the licence does not expire. Used for a warning banner in the app. */
export const daysLeft = (e: Entitlements | undefined, now = new Date()): number | null => (e?.restricted && e.expiresAt ? Math.ceil((e.expiresAt.getTime() - now.getTime()) / 86_400_000) : null);

export const MODULE_KEY = 'entitlements:modules';
/** On a controller or route: it belongs to these modules (any one licensed is enough). A route with none is Core. */
export const RequiresModule = (...modules: ModuleName[]) => SetMetadata(MODULE_KEY, modules);

const COUNTS: Record<LimitKey, ReturnType<typeof sql>> = {
  users: sql`SELECT count(*)::int AS n FROM erp.users WHERE status <> 'disabled'`,
  companies: sql`SELECT count(*)::int AS n FROM erp.companies`,
  locations: sql`SELECT count(*)::int AS n FROM erp.business_locations`,
  terminals: sql`SELECT count(*)::int AS n FROM erp.pos_terminals`,
};
/** Call inside the transaction that creates the thing: refuses when the tenant's licence caps how many it may have. */
export async function assertWithinLimit(tx: Tx, tenantId: string, key: LimitKey): Promise<void> {
  const lim = await tx.execute<{ v: string | null }>(sql`SELECT limits ->> ${key} AS v FROM erp.tenant_entitlements WHERE tenant_id = ${tenantId}::uuid`);
  const raw = lim.rows[0]?.v;
  if (raw == null) return;
  const max = Number(raw);
  const have = await tx.execute<{ n: number }>(sql`${COUNTS[key]}`);
  if ((have.rows[0]?.n ?? 0) >= max) throw new AppError(409, 'limit_reached', `Your licence allows ${max} ${key}. Ask your administrator to upgrade the plan to add more.`, { limit: key, max });
}
