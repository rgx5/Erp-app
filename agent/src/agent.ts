import type { AgentConfig } from './config.js';
import type { ControlPlane } from './controlPlane.js';
import { collectHeartbeat, type HeartbeatPorts } from './heartbeat.js';
import { syncLicence, type LicencePorts } from './licence.js';
import type { StateStore } from './state.js';
import { superviseSupport, type SupportPorts } from './support.js';
import { reportTenants, runCommands, runValidations, type PlatformPorts } from './platform.js';
import { upgrade, type UpgradePorts } from './upgrade.js';
import { inWindow } from './window.js';

export const AGENT_VERSION = '0.1.0';
export interface AgentDeps { config: Pick<AgentConfig, 'releasePublicKey' | 'retryFailedUpgradeHours'>; cp: ControlPlane; state: StateStore; heartbeat: HeartbeatPorts; upgrade: UpgradePorts; licence: LicencePorts; platform: PlatformPorts; support: SupportPorts; log?: (msg: string) => void }

/** One agent's duties, each safe to run on its own and to fail without stopping the others. */
export class Agent {
  constructor(private readonly d: AgentDeps) {}
  private log(m: string): void { (this.d.log ?? ((x) => console.log(x)))(m); }
  private async guarded(name: string, fn: () => Promise<unknown>): Promise<void> { try { await fn(); } catch (e) { this.log(`${name}: ${e instanceof Error ? e.message : String(e)}`); } }

  async sendHeartbeat(): Promise<void> {
    await this.guarded('heartbeat', async () => this.d.cp.heartbeat(await collectHeartbeat(this.d.heartbeat, this.d.state.read(), AGENT_VERSION)));
  }
  async syncLicence(): Promise<void> {
    await this.guarded('licence', async () => { const r = await syncLicence(this.d.cp, this.d.licence, this.d.state); if (r.applied) this.log(`${r.applied} licence(s) applied`); if (r.failed.length) this.log(`licence: ${r.failed.join('; ')}`); });
  }
  async reportTenants(): Promise<void> { await this.guarded('tenants', () => reportTenants(this.d.cp, this.d.platform)); }
  async validate(now = new Date()): Promise<void> { await this.guarded('validation', () => runValidations(this.d.cp, this.d.platform, this.d.state, now)); }
  async runCommands(now = new Date()): Promise<number> { let n = 0; await this.guarded('commands', async () => { n = await runCommands(this.d.cp, this.d.platform, this.d.state, now); }); return n; }
  async supervise(now = new Date()): Promise<string | undefined> {
    let result: string | undefined;
    await this.guarded('support', async () => { result = await superviseSupport(this.d.cp, this.d.support, this.d.state, now); });
    return result;
  }
  /** Looks for a release and, only inside the maintenance window, applies it. A release that just failed is not retried at once. */
  async checkRelease(now = new Date()): Promise<string | undefined> {
    let result: string | undefined;
    await this.guarded('release', async () => {
      const state = this.d.state.read();
      const offer = await this.d.cp.release(state.current?.version ?? null);
      if (!offer.release) { result = offer.reason ?? 'none'; return; }
      if (!inWindow(now, offer.maintenanceWindow)) { result = 'outside_window'; return; }
      const last = state.lastUpgrade;
      if (last && last.toVersion === offer.release.manifest.version && last.outcome !== 'success' && now.getTime() - new Date(last.at).getTime() < this.d.config.retryFailedUpgradeHours * 3_600_000) { result = 'recently_failed'; return; }
      const out = await upgrade(offer.release.manifest, offer.release.signature, { ports: this.d.upgrade, state: this.d.state, publicKey: this.d.config.releasePublicKey, now: () => now });
      this.log(`upgrade to ${out.toVersion}: ${out.outcome}${out.detail ? ` (${out.detail})` : ''}`);
      result = out.outcome;
      await this.sendHeartbeat(); // tell the control plane the outcome straight away
    });
    return result;
  }
}
