import type { AgentConfig } from './config.js';
import type { ControlPlane } from './controlPlane.js';
import type { StateStore } from './state.js';

export interface TenantSummary { id: string; slug: string; name: string; status: 'active' | 'suspended'; createdAt?: string; usage: Record<string, number | string | null>; licence: Record<string, unknown> }
export interface ValidationResult { tenantId: string; at: string; ok: boolean; checks: { key: string; label: string; status: 'pass' | 'warn' | 'fail'; detail: string }[] }

/** What the agent asks of the product server about its tenants (the platform endpoints; counts and pass/fail only). */
export interface PlatformPorts {
  listTenants(): Promise<TenantSummary[]>;
  validate(tenantId: string): Promise<ValidationResult>;
  setStatus(tenantId: string, status: 'active' | 'suspended', reason: string): Promise<void>;
}

export function platformPorts(c: Pick<AgentConfig, 'localApiUrl' | 'platformAdminToken'>): PlatformPorts {
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${c.localApiUrl}${path}`, { method, headers: { authorization: `Bearer ${c.platformAdminToken}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`${method} ${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  };
  return {
    listTenants: async () => (await call<{ items: TenantSummary[] }>('GET', '/v1/platform/tenants')).items,
    validate: (id) => call<ValidationResult>('GET', `/v1/platform/tenants/${id}/validate`),
    setStatus: async (id, status, reason) => { await call('POST', `/v1/platform/tenants/${id}/status`, { status, reason }); },
  };
}

export const VALIDATE_EVERY_HOURS = 24;

/** Tells the control plane which tenants this cell hosts, with their usage and licence. */
export async function reportTenants(cp: ControlPlane, p: PlatformPorts): Promise<number> {
  const items = await p.listTenants();
  await cp.reportTenants(items);
  return items.length;
}

/** Runs each tenant's checks once a day (or when asked) and reports the results. A check that cannot run is reported as a failure, not skipped. */
export async function runValidations(cp: ControlPlane, p: PlatformPorts, state: StateStore, now: Date, o: { only?: string } = {}): Promise<{ checked: number; failed: string[] }> {
  const tenants = (await p.listTenants()).filter((t) => !o.only || t.id === o.only);
  let checked = 0; const failed: string[] = [];
  for (const t of tenants) {
    const last = state.read().validatedAt[t.id];
    if (!o.only && last && now.getTime() - new Date(last).getTime() < VALIDATE_EVERY_HOURS * 3_600_000) continue;
    let report: ValidationResult;
    try { report = await p.validate(t.id); } catch (e) { report = { tenantId: t.id, at: now.toISOString(), ok: false, checks: [{ key: 'validation_ran', label: 'Checks could run', status: 'fail', detail: (e instanceof Error ? e.message : String(e)).slice(0, 400) }] }; }
    await cp.reportValidation(report);
    state.update((s) => { s.validatedAt[t.id] = now.toISOString(); });
    checked++; if (!report.ok) failed.push(t.slug);
  }
  return { checked, failed };
}

/** Does the work staff asked for on this cell and reports each result. */
export async function runCommands(cp: ControlPlane, p: PlatformPorts, state: StateStore, now: Date): Promise<number> {
  const commands = await cp.commands();
  for (const c of commands) {
    try {
      if (c.type === 'validate') { await runValidations(cp, p, state, now, { only: c.tenantId }); await cp.commandResult(c.id, { ok: true, message: 'checks run and reported' }); }
      else { await p.setStatus(c.tenantId, c.type === 'suspend' ? 'suspended' : 'active', c.payload.reason ?? c.type); await reportTenants(cp, p); await cp.commandResult(c.id, { ok: true, message: c.type === 'suspend' ? 'tenant suspended' : 'tenant reactivated' }); }
    } catch (e) { await cp.commandResult(c.id, { ok: false, message: (e instanceof Error ? e.message : String(e)).slice(0, 400) }).catch(() => undefined); }
  }
  return commands.length;
}
