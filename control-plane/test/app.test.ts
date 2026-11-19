import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyDocument } from '../src/crypto.js';
import { publicKeyOf } from '../src/crypto.js';
import { testApp } from './support.js';

let t: Awaited<ReturnType<typeof testApp>>;
let admin: Awaited<ReturnType<typeof t.staff>>; let support: typeof admin; let viewer: typeof admin;
beforeAll(async () => { t = await testApp(); admin = await t.staff('admin'); support = await t.staff('support'); viewer = await t.staff('viewer'); });
afterAll(async () => { await t.close(); });

const TENANT = '01a1ef97-0534-7459-b710-dd1bfcf733a3';
async function makeSite(code: string, o: { tier?: string; tenant?: string | null; ring?: number } = {}) {
  const client = (await t.call('POST', '/clients', support.token, { name: `Client ${code}`, tier: o.tier ?? 'hybrid' })).json;
  const site = (await t.call('POST', '/sites', support.token, { clientId: client.id, code, name: `Site ${code}`, ...(o.tenant === null ? {} : { tenantId: o.tenant ?? TENANT }), ring: o.ring ?? 2 })).json;
  const token = (await t.call('POST', `/sites/${site.id}/agent-token`, admin.token)).json.token as string;
  return { client, site, token };
}
const beat = (token: string, body: object) => t.call('POST', '/agent/heartbeat', token, body);
const fresh = () => ({ version: '1.0.0', db: { ok: true }, backup: { lastBaseBackupAt: new Date().toISOString(), lastWalShippedAt: new Date().toISOString(), walQueueBytes: 0 }, disk: { freePercent: 70 }, tunnel: { up: true } });

describe('staff sign-in and roles', () => {
  it('signs in, reads who you are, signs out, and refuses a dead session', async () => {
    const me = await t.call('GET', '/me', viewer.token);
    expect(me.json).toMatchObject({ role: 'viewer' });
    const s = await t.staff('viewer');
    expect((await t.call('POST', '/auth/logout', s.token)).status).toBe(204);
    expect((await t.call('GET', '/me', s.token)).status).toBe(401);
    expect((await t.call('GET', '/fleet', null)).status).toBe(401);
  });
  it('locks an account after five wrong passwords', async () => {
    const s = await t.staff('support', 'another-long-password-9');
    for (let i = 0; i < 5; i++) expect((await t.call('POST', '/auth/login', null, { email: s.email, password: 'wrong-password-1' })).status).toBe(401);
    const locked = await t.call('POST', '/auth/login', null, { email: s.email, password: s.password });
    expect(locked.status).toBe(429); expect(locked.json.code).toBe('locked');
  });
  it('lets each role do only its part', async () => {
    expect((await t.call('GET', '/fleet', viewer.token)).status).toBe(200);
    expect((await t.call('POST', '/clients', viewer.token, { name: 'X', tier: 'local' })).status).toBe(403);
    expect((await t.call('POST', '/clients', support.token, { name: 'Y', tier: 'local' })).status).toBe(201);
    expect((await t.call('POST', '/releases', support.token, {})).status).toBe(403);
    expect((await t.call('GET', '/audit', support.token)).status).toBe(403);
    expect((await t.call('GET', '/audit', admin.token)).status).toBe(200);
    expect((await t.call('POST', '/staff', admin.token, { email: 'new@example.com', displayName: 'New', password: 'a-long-staff-password-1', role: 'viewer' })).status).toBe(201);
    expect((await t.call('POST', '/staff', admin.token, { email: 'NEW@example.com', displayName: 'New', password: 'a-long-staff-password-1', role: 'viewer' })).json.code).toBe('staff_exists');
    expect((await t.call('POST', '/staff', admin.token, { email: 'weak@example.com', displayName: 'Weak', password: 'short', role: 'viewer' })).status).toBe(422);
  });
});

describe('sites, agents and the fleet', () => {
  it('registers a site, accepts its heartbeats, and shows its health', async () => {
    const a = await makeSite('PUNE-01');
    expect((await t.call('GET', '/fleet', viewer.token)).json.items.find((s: { code: string }) => s.code === 'PUNE-01').health.state).toBe('never');
    expect((await beat(a.token, fresh())).status).toBe(200);
    const fleet = (await t.call('GET', '/fleet', viewer.token)).json;
    const row = fleet.items.find((s: { code: string }) => s.code === 'PUNE-01');
    expect(row).toMatchObject({ status: 'active', version: '1.0.0', health: { state: 'healthy' } });
    // a problem shows up with its reason
    await beat(a.token, { ...fresh(), disk: { freePercent: 8 }, tunnel: { up: false } });
    const bad = (await t.call('GET', '/fleet?state=degraded', viewer.token)).json;
    expect(bad.items.map((s: { code: string }) => s.code)).toContain('PUNE-01');
    expect(bad.items.find((s: { code: string }) => s.code === 'PUNE-01').health.reasons).toEqual(expect.arrayContaining(['Disk is 92% full', 'Remote-access tunnel is down']));
    const detail = (await t.call('GET', `/sites/${a.site.id}`, viewer.token)).json;
    expect(detail.recentHeartbeats.length).toBeGreaterThanOrEqual(2);
    // silent once it stops reporting
    await t.pool.query("UPDATE site_status SET last_seen_at = now() - interval '30 minutes' WHERE site_id = $1", [a.site.id]);
    expect((await t.call('GET', '/fleet?state=silent', viewer.token)).json.items.map((s: { code: string }) => s.code)).toContain('PUNE-01');
  });
  it('refuses a missing, wrong or replaced agent token', async () => {
    const a = await makeSite('NAGPUR-01');
    expect((await beat('', fresh())).status).toBe(401);
    expect((await beat(`${a.token.slice(0, -4)}xxxx`, fresh())).status).toBe(401);
    expect((await beat(`cpa_${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}_abcdefghijklmnopqrstuvwxyz`, fresh())).status).toBe(401);
    const again = (await t.call('POST', `/sites/${a.site.id}/agent-token`, admin.token)).json.token as string;
    expect((await beat(a.token, fresh())).status).toBe(401); // the old token stopped working
    expect((await beat(again, fresh())).status).toBe(200);
    expect((await t.call('POST', `/sites/${a.site.id}/agent-token`, support.token)).status).toBe(403);
  });
  it('updates a site: ring, pause, maintenance window, status', async () => {
    const a = await makeSite('NASIK-01');
    const r = await t.call('PATCH', `/sites/${a.site.id}`, support.token, { ring: 0, updatesPaused: true, maintenanceWindow: { days: [6], startHour: 1, durationHours: 2, timezone: 'Asia/Kolkata' } });
    expect(r.json).toMatchObject({ ring: 0, updates_paused: true });
    expect((await t.call('PATCH', `/sites/${a.site.id}`, support.token, { ring: 7 })).status).toBe(422);
    expect((await t.call('POST', '/sites', support.token, { clientId: a.client.id, code: 'nasik-01', name: 'Dup' })).json.code).toBe('site_exists');
  });
});

describe('licences', () => {
  it('issues a signed licence bound to the site\'s tenant, and hands it to the agent', async () => {
    const a = await makeSite('LIC-01');
    const issued = await t.call('POST', `/sites/${a.site.id}/licences`, admin.token, { plan: 'Hybrid', modules: ['sales', 'inventory', 'pos'], limits: { users: 10 }, expiresAt: '2027-04-01T00:00:00.000Z' });
    expect(issued.status).toBe(201);
    expect(issued.json.licence).toMatchObject({ licenceId: 'LIC-LIC-01-001', tenantId: TENANT, plan: 'Hybrid', modules: ['inventory', 'pos', 'sales'], readOnly: false });
    const pub = publicKeyOf(t.config.LICENCE_PRIVATE_KEY);
    expect(verifyDocument(issued.json.licence, issued.json.signature, pub)).toBe(true);
    expect((await t.call('GET', '/keys', null)).json.licencePublicKey).toBe(pub);
    const fetched = await t.call('GET', '/agent/licence', a.token);
    expect(fetched.json).toMatchObject({ tenantId: TENANT, licence: { licenceId: 'LIC-LIC-01-001' } });
    // a newer licence supersedes; a revoked one is no longer served
    const second = await t.call('POST', `/sites/${a.site.id}/licences`, admin.token, { plan: 'Hybrid', modules: ['sales', 'inventory', 'pos', 'accounting'] });
    expect(second.json.licence.licenceId).toBe('LIC-LIC-01-002');
    expect((await t.call('GET', '/agent/licence', a.token)).json.licence.licenceId).toBe('LIC-LIC-01-002');
    expect((await t.call('POST', `/licences/LIC-LIC-01-002/revoke`, admin.token, { reason: 'Issued by mistake' })).status).toBe(200);
    expect((await t.call('GET', '/agent/licence', a.token)).json.licence.licenceId).toBe('LIC-LIC-01-001');
    expect((await t.call('GET', '/fleet', viewer.token)).json.items.find((s: { code: string }) => s.code === 'LIC-01').licence).toMatchObject({ licenceId: 'LIC-LIC-01-001', plan: 'Hybrid' });
  });
  it('refuses modules without their dependencies, a site with no tenant, and non-admins', async () => {
    const a = await makeSite('LIC-02');
    expect((await t.call('POST', `/sites/${a.site.id}/licences`, admin.token, { plan: 'X', modules: ['pos'] })).json.code).toBe('module_dependency');
    expect((await t.call('POST', `/sites/${a.site.id}/licences`, admin.token, { plan: 'X', modules: ['bogus'] })).status).toBe(422);
    expect((await t.call('POST', `/sites/${a.site.id}/licences`, support.token, { plan: 'X', modules: ['sales'] })).status).toBe(403);
    const none = await makeSite('LIC-03', { tenant: null });
    expect((await t.call('POST', `/sites/${none.site.id}/licences`, admin.token, { plan: 'X', modules: ['sales'] })).json.code).toBe('no_tenant');
    expect((await t.call('GET', '/agent/licence', none.token)).json.code).toBe('no_licence');
  });
});

describe('releases', () => {
  const rel = (version: string, o: object = {}) => ({ version, images: [{ name: 'api', digest: `sha256:${'a'.repeat(64)}` }], migrationDigest: `sha256:${'b'.repeat(64)}`, notes: `Release ${version}`, ...o });
  it('signs a manifest, opens it ring by ring, and serves each site the newest release open to it', async () => {
    const own = await makeSite('R-OWN', { ring: 0 }); const friend = await makeSite('R-FRIEND', { ring: 1 }); const rest = await makeSite('R-REST', { ring: 2 });
    const created = await t.call('POST', '/releases', admin.token, rel('2.0.0', { minClientVersion: '1.4.0' }));
    expect(created.status).toBe(201);
    expect((await t.call('POST', '/releases', admin.token, rel('2.0.0'))).json.code).toBe('release_exists');
    const ask = async (s: { token: string }, current?: string) => (await t.call('GET', `/agent/release${current ? `?current=${current}` : ''}`, s.token)).json;
    expect((await ask(own)).release).toBeNull(); // a draft is not served
    await t.call('POST', `/releases/${created.json.id}/promote`, admin.token); // ring 0
    const r0 = await ask(own);
    expect(r0.release.manifest).toMatchObject({ version: '2.0.0', minClientVersion: '1.4.0' });
    expect(verifyDocument(r0.release.manifest, r0.release.signature, publicKeyOf(t.config.RELEASE_PRIVATE_KEY))).toBe(true);
    expect((await ask(friend)).release).toBeNull(); expect((await ask(rest)).release).toBeNull();
    await t.call('POST', `/releases/${created.json.id}/promote`, admin.token); // ring 1
    expect((await ask(friend)).release.manifest.version).toBe('2.0.0'); expect((await ask(rest)).release).toBeNull();
    await t.call('POST', `/releases/${created.json.id}/promote`, admin.token); // ring 2
    expect((await ask(rest)).release.manifest.version).toBe('2.0.0');
    expect((await t.call('POST', `/releases/${created.json.id}/promote`, admin.token)).json.code).toBe('fully_released');
    expect((await ask(rest, '2.0.0')).release).toBeNull(); // already there
    // a newer release wins, and a withdrawn one disappears
    const newer = await t.call('POST', '/releases', admin.token, rel('2.1.0'));
    for (let i = 0; i < 3; i++) await t.call('POST', `/releases/${newer.json.id}/promote`, admin.token);
    expect((await ask(rest, '2.0.0')).release.manifest.version).toBe('2.1.0');
    await t.call('POST', `/releases/${newer.json.id}/withdraw`, admin.token, { reason: 'Found a bug' });
    expect((await ask(rest, '1.9.0')).release.manifest.version).toBe('2.0.0');
    expect((await t.call('POST', `/releases/${newer.json.id}/promote`, admin.token)).json.code).toBe('withdrawn');
  });
  it('serves nothing to a site whose updates are paused, and validates the manifest', async () => {
    const a = await makeSite('R-PAUSED', { ring: 0 });
    const r = await t.call('POST', '/releases', admin.token, rel('3.0.0'));
    await t.call('POST', `/releases/${r.json.id}/promote`, admin.token);
    await t.call('PATCH', `/sites/${a.site.id}`, support.token, { updatesPaused: true });
    expect((await t.call('GET', '/agent/release', a.token)).json).toMatchObject({ release: null, reason: 'updates_paused' });
    expect((await t.call('POST', '/releases', admin.token, { ...rel('3.1.0'), images: [{ name: 'api', digest: 'latest' }] })).status).toBe(422);
    expect((await t.call('POST', '/releases', admin.token, rel('v3'))).status).toBe(422);
  });
});

describe('approved remote support', () => {
  const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoFKLnBJyw5Ky+1HbM5H4Aa7yzP support@example.com';
  it('goes through request, code, open and close, and only the site can say the code is right', async () => {
    const a = await makeSite('SUP-01');
    const req = await t.call('POST', `/sites/${a.site.id}/support-sessions`, support.token, { reason: 'Printer will not print receipts', minutes: 30, publicKey: KEY });
    expect(req.status).toBe(201);
    expect((await t.call('POST', `/sites/${a.site.id}/support-sessions`, support.token, { reason: 'Second request here', minutes: 30, publicKey: KEY })).json.code).toBe('session_active');
    const seen = (await t.call('GET', '/agent/support', a.token)).json;
    expect(seen.session).toMatchObject({ id: req.json.id, status: 'requested', minutes: 30, publicKey: KEY, enteredCode: null });
    expect((await t.call('POST', `/support-sessions/${req.json.id}/code`, support.token, { code: '123456' })).json.code).toBe('not_awaiting_code'); // too early
    expect((await t.call('POST', `/agent/support/${req.json.id}/state`, a.token, { state: 'open' })).json.code).toBe('bad_state'); // cannot skip the code
    await t.call('POST', `/agent/support/${req.json.id}/state`, a.token, { state: 'awaiting_code' });
    expect((await t.call('POST', `/support-sessions/${req.json.id}/code`, support.token, { code: '12ab56' })).status).toBe(422);
    expect((await t.call('POST', `/support-sessions/${req.json.id}/code`, support.token, { code: '123456' })).status).toBe(200);
    expect((await t.call('GET', '/agent/support', a.token)).json.session).toMatchObject({ status: 'awaiting_code', enteredCode: '123456' });
    const expires = new Date(Date.now() + 30 * 60_000).toISOString();
    expect((await t.call('POST', `/agent/support/${req.json.id}/state`, a.token, { state: 'open', expiresAt: expires })).status).toBe(200);
    const open = (await t.call('GET', '/agent/support', a.token)).json.session;
    expect(open).toMatchObject({ status: 'open', enteredCode: null, expiresAt: expires });
    expect((await t.call('POST', `/support-sessions/${req.json.id}/close`, viewer.token)).status).toBe(403);
    expect((await t.call('POST', `/support-sessions/${req.json.id}/close`, support.token)).status).toBe(200);
    const after = (await t.call('GET', '/agent/support', a.token)).json;
    expect(after.session).toBeNull(); expect(after.endedSessionIds).toContain(req.json.id);
    expect((await t.call('GET', `/sites/${a.site.id}/support-sessions`, viewer.token)).json.items[0]).toMatchObject({ status: 'closed', reason: 'Printer will not print receipts' });
  });
  it('lets the site refuse, validates the request, and keeps every step in the audit', async () => {
    const a = await makeSite('SUP-02');
    expect((await t.call('POST', `/sites/${a.site.id}/support-sessions`, support.token, { reason: 'Hi', minutes: 30, publicKey: KEY })).status).toBe(422);
    expect((await t.call('POST', `/sites/${a.site.id}/support-sessions`, support.token, { reason: 'Looking at slow reports', minutes: 500, publicKey: KEY })).status).toBe(422);
    expect((await t.call('POST', `/sites/${a.site.id}/support-sessions`, support.token, { reason: 'Looking at slow reports', minutes: 30, publicKey: 'not a key' })).status).toBe(422);
    const r = await t.call('POST', `/sites/${a.site.id}/support-sessions`, support.token, { reason: 'Looking at slow reports', minutes: 30, publicKey: KEY });
    await t.call('POST', `/agent/support/${r.json.id}/state`, a.token, { state: 'awaiting_code' });
    await t.call('POST', `/agent/support/${r.json.id}/state`, a.token, { state: 'refused' });
    expect((await t.call('GET', '/agent/support', a.token)).json.session).toBeNull();
    const log = (await t.call('GET', '/audit', admin.token)).json.items as { action: string }[];
    for (const x of ['support.requested', 'support.awaiting_code', 'support.refused']) expect(log.map((e) => e.action)).toContain(x);
    // another site's agent cannot touch this session
    const other = await makeSite('SUP-03');
    const r2 = await t.call('POST', `/sites/${other.site.id}/support-sessions`, support.token, { reason: 'Looking at slow reports', minutes: 30, publicKey: KEY });
    await t.call('POST', `/agent/support/${r2.json.id}/state`, a.token, { state: 'refused' });
    expect((await t.call('GET', '/agent/support', other.token)).json.session).toMatchObject({ status: 'requested' });
  });
});

describe('fleet screen', () => {
  it('serves the page and the health check without sign-in', async () => {
    const page = await t.app.inject({ method: 'GET', url: '/ui' });
    expect(page.statusCode).toBe(200); expect(page.headers['content-type']).toContain('text/html'); expect(page.body).toContain('Control Plane');
    expect((await t.call('GET', '/health', null)).json.ok).toBe(true);
  });
});

describe('audit', () => {
  it('records what staff did', async () => {
    const log = (await t.call('GET', '/audit', admin.token)).json.items as { action: string }[];
    for (const a of ['staff.login', 'client.created', 'site.created', 'site.agent_token_issued', 'licence.issued', 'licence.revoked', 'release.created', 'release.promoted', 'release.withdrawn']) expect(log.map((e) => e.action)).toContain(a);
  });
});
