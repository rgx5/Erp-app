import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../control-plane/test/support.js';
import { Agent } from '../src/agent.js';
import { ControlPlane } from '../src/controlPlane.js';
import type { HeartbeatPorts } from '../src/heartbeat.js';
import type { LicencePorts } from '../src/licence.js';
import type { SupportPorts } from '../src/support.js';
import { fakePorts, tempState } from './helpers.js';

// The real control plane (in this process, on a real port and database) and the real agent logic, with only the machine faked.
let cp: Awaited<ReturnType<typeof testApp>>;
let base = ''; let publicKey = '';
let admin: { token: string }; let support: { token: string };
beforeAll(async () => {
  cp = await testApp();
  await cp.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(cp.app.server.address() as AddressInfo).port}`;
  admin = await cp.staff('admin'); support = await cp.staff('support');
  publicKey = (await cp.call('GET', '/keys', null)).json.releasePublicKey as string;
});
afterAll(async () => { await cp.close(); });

const TENANT = '01a1ef97-0534-7459-b710-dd1bfcf733a3';
const NOW = new Date('2026-11-22T02:30:00Z'); // Sunday 08:00 in India
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoFKLnBJyw5Ky+1HbM5H4Aa7yzP s@example.com';

async function site(code: string, tier = 'hybrid') {
  const client = (await cp.call('POST', '/clients', support.token, { name: `Client ${code}`, tier })).json;
  const s = (await cp.call('POST', '/sites', support.token, { clientId: client.id, code, name: code, tenantId: TENANT, ring: 2 })).json;
  await cp.call('PATCH', `/sites/${s.id}`, support.token, { maintenanceWindow: { days: [0], startHour: 8, durationHours: 3, timezone: 'Asia/Kolkata' } });
  const token = (await cp.call('POST', `/sites/${s.id}/agent-token`, admin.token)).json.token as string;
  const state = tempState();
  const upgrade = fakePorts();
  const imported: unknown[] = [];
  let shown: string | null = null; let access = false;
  const heartbeat: HeartbeatPorts = { dbHealthy: async () => true, replicationLagSeconds: async () => undefined, freeDiskPercent: async () => 64.26, backupStatus: async () => ({ lastBaseBackupAt: NOW.toISOString(), lastWalShippedAt: NOW.toISOString(), walQueueBytes: 0 }), tunnelUp: async () => true };
  const licence: LicencePorts = { importLicence: async (_t, signed) => { imported.push(signed); } };
  const supportPorts: SupportPorts = { showCode: async (c) => { shown = c; }, openAccess: async () => { access = true; }, closeAccess: async () => { access = false; } };
  const log: string[] = [];
  const agent = new Agent({ config: { releasePublicKey: publicKey, retryFailedUpgradeHours: 6 }, cp: new ControlPlane(base, token), state, heartbeat, upgrade, licence, support: supportPorts, log: (m) => log.push(m) });
  return { id: s.id as string, agent, state, upgrade, imported, log, get shown() { return shown; }, get access() { return access; } };
}
const fleetRow = async (code: string) => ((await cp.call('GET', '/fleet', admin.token)).json.items as { code: string; version: string | null; health: { state: string; reasons: string[] } }[]).find((s) => s.code === code);
const release = async (version: string) => {
  const r = (await cp.call('POST', '/releases', admin.token, { version, images: [{ name: 'api', digest: `sha256:${'a'.repeat(64)}` }], migrationDigest: `sha256:${'b'.repeat(64)}`, notes: version })).json;
  for (let i = 0; i < 3; i++) await cp.call('POST', `/releases/${r.id}/promote`, admin.token);
  return r.id as string;
};

describe('agent with the real control plane', () => {
  it('reports health that the fleet screen shows, and takes its licence once', async () => {
    const a = await site('E2E-01');
    await a.agent.sendHeartbeat();
    expect(await fleetRow('E2E-01')).toMatchObject({ health: { state: 'healthy' } });
    expect(a.log).toEqual([]);
    await cp.call('POST', `/sites/${a.id}/licences`, admin.token, { plan: 'Hybrid', modules: ['sales', 'inventory'] });
    await a.agent.syncLicence(); await a.agent.syncLicence();
    expect(a.imported).toHaveLength(1); // the second sync saw nothing new
    expect((a.imported[0] as { licence: { plan: string } }).licence.plan).toBe('Hybrid');
  });

  it('installs a release the control plane signed, inside the window only, and the fleet shows the new version', async () => {
    const a = await site('E2E-02');
    await release('2.0.0');
    expect(await a.agent.checkRelease(new Date('2026-11-23T08:30:00Z'))).toBe('outside_window'); // Monday
    expect(a.upgrade.calls).toEqual([]);
    expect(await a.agent.checkRelease(NOW)).toBe('success');
    expect(a.upgrade.calls).toEqual(['disk', 'backup pre-2.0.0', 'pull 2.0.0', 'migrate 2.0.0', 'start 2.0.0', 'health']);
    expect(await fleetRow('E2E-02')).toMatchObject({ version: '2.0.0', health: { state: 'healthy' } });
    expect(await a.agent.checkRelease(NOW)).toBe('up_to_date');
  });

  it('shows a failed upgrade on the fleet screen, and does not hammer a release that just failed', async () => {
    const a = await site('E2E-03');
    a.state.update((s) => { s.current = { version: '1.0.0', images: [{ name: 'api', digest: `sha256:${'a'.repeat(64)}` }], migrationDigest: `sha256:${'b'.repeat(64)}`, minClientVersion: null, maxClientVersion: null, notes: '', createdAt: '2026-01-01T00:00:00.000Z' }; });
    await release('2.5.0');
    const bad = fakePorts({ healthyNew: false });
    const failing = new Agent({ config: { releasePublicKey: publicKey, retryFailedUpgradeHours: 6 }, cp: (a.agent as unknown as { d: { cp: ControlPlane } }).d.cp, state: a.state, heartbeat: (a.agent as unknown as { d: { heartbeat: HeartbeatPorts } }).d.heartbeat, upgrade: bad, licence: { importLicence: async () => undefined }, support: { showCode: async () => undefined, openAccess: async () => undefined, closeAccess: async () => undefined }, log: () => undefined });
    expect(await failing.checkRelease(NOW)).toBe('rolled_back');
    const row = await fleetRow('E2E-03');
    expect(row?.health.state).toBe('degraded');
    expect(row?.health.reasons.join(' ')).toMatch(/Upgrade to 2.5.0 did not finish \(rolled back\)/);
    expect(await failing.checkRelease(new Date(NOW.getTime() + 3_600_000))).toBe('recently_failed');
    expect(bad.calls.filter((c) => c.startsWith('backup'))).toHaveLength(1);
    expect(await failing.checkRelease(new Date(NOW.getTime() + 7 * 3_600_000))).toBe('outside_window'); // retried only when the window allows
  });

  it('runs an approved support session from request to automatic close', async () => {
    const a = await site('E2E-04');
    const req = (await cp.call('POST', `/sites/${a.id}/support-sessions`, support.token, { reason: 'Receipts will not print', minutes: 20, publicKey: KEY })).json;
    expect(await a.agent.supervise(NOW)).toBe('awaiting_code');
    expect(a.shown).toMatch(/^\d{6}$/);
    const wrong = a.shown === '000000' ? '111111' : '000000';
    await cp.call('POST', `/support-sessions/${req.id}/code`, support.token, { code: wrong });
    expect(await a.agent.supervise(NOW)).toBe('wrong_code'); expect(a.access).toBe(false);
    await cp.call('POST', `/support-sessions/${req.id}/code`, support.token, { code: a.shown });
    expect(await a.agent.supervise(NOW)).toBe('opened'); expect(a.access).toBe(true);
    expect((await cp.call('GET', `/sites/${a.id}/support-sessions`, support.token)).json.items[0]).toMatchObject({ status: 'open' });
    expect(await a.agent.supervise(new Date(NOW.getTime() + 25 * 60_000))).toBe('closed');
    expect(a.access).toBe(false);
    expect((await cp.call('GET', `/sites/${a.id}/support-sessions`, support.token)).json.items[0]).toMatchObject({ status: 'closed' });
  });
});
