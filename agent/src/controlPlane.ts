import type { MaintenanceWindow } from './window.js';
import type { Manifest } from './verify.js';

export interface SupportSessionInfo { id: string; status: 'requested' | 'awaiting_code' | 'open'; reason: string; minutes: number; publicKey: string; enteredCode: string | null; expiresAt: string | null }

/** The agent's calls to the control plane. Every one is an outbound request from the site; nothing connects in. */
export class ControlPlane {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly fetchFn: typeof fetch = fetch) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    return { status: res.status, json: (text ? JSON.parse(text) : {}) as T };
  }
  async heartbeat(payload: object): Promise<void> { const r = await this.call('POST', '/agent/heartbeat', payload); if (r.status !== 200) throw new Error(`heartbeat refused (${r.status})`); }
  async licence(): Promise<{ licence: { licenceId: string; tenantId: string }; signature: string; tenantId: string | null } | null> {
    const r = await this.call<{ licence: { licenceId: string; tenantId: string }; signature: string; tenantId: string | null }>('GET', '/agent/licence');
    if (r.status === 404) return null;
    if (r.status !== 200) throw new Error(`licence request refused (${r.status})`);
    return r.json;
  }
  async release(current: string | null): Promise<{ release: { manifest: Manifest; signature: string } | null; maintenanceWindow: MaintenanceWindow; reason?: string }> {
    const r = await this.call<{ release: { manifest: Manifest; signature: string } | null; maintenanceWindow: MaintenanceWindow; reason?: string }>('GET', `/agent/release${current ? `?current=${current}` : ''}`);
    if (r.status !== 200) throw new Error(`release request refused (${r.status})`);
    return r.json;
  }
  async support(): Promise<{ session: SupportSessionInfo | null; endedSessionIds: string[] }> {
    const r = await this.call<{ session: SupportSessionInfo | null; endedSessionIds: string[] }>('GET', '/agent/support');
    if (r.status !== 200) throw new Error(`support request refused (${r.status})`);
    return r.json;
  }
  async supportState(id: string, body: { state: 'awaiting_code' | 'open' | 'closed' | 'refused'; expiresAt?: string }): Promise<void> {
    const r = await this.call('POST', `/agent/support/${id}/state`, body);
    if (r.status !== 200) throw new Error(`support state refused (${r.status})`);
  }
}
