import { Injectable } from '@nestjs/common';

type Listener = (areas: string[]) => void;

/**
 * Tells interested parties that a client's data changed, in process: "sales changed for tenant X". Screens use it to refresh only what is open
 * instead of asking the server again and again; the dashboard cache uses it to drop its copy. It carries no data, only the area names, and each
 * server instance only knows about changes made through itself (so run one API instance per cell, or accept that another instance's changes are
 * noticed by the screens' own slower refresh).
 */
@Injectable()
export class ChangeBus {
  private readonly byTenant = new Map<string, Set<Listener>>();
  private readonly all = new Set<(tenantId: string, areas: string[]) => void>();

  publish(tenantId: string, areas: string[]): void {
    for (const l of this.byTenant.get(tenantId) ?? []) l(areas);
    for (const l of this.all) l(tenantId, areas);
  }
  subscribe(tenantId: string, l: Listener): () => void {
    const set = this.byTenant.get(tenantId) ?? new Set<Listener>();
    set.add(l); this.byTenant.set(tenantId, set);
    return () => { set.delete(l); if (set.size === 0) this.byTenant.delete(tenantId); };
  }
  /** Every change on every tenant (for server-side caches). */
  subscribeAll(l: (tenantId: string, areas: string[]) => void): () => void { this.all.add(l); return () => { this.all.delete(l); }; }
  get listeners(): number { let n = 0; for (const s of this.byTenant.values()) n += s.size; return n; }
}
