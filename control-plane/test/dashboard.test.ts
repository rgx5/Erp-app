import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './support.js';

let t: Awaited<ReturnType<typeof testApp>>;
let admin: { token: string }; let support: typeof admin; let viewer: typeof admin;
beforeAll(async () => { t = await testApp(); admin = await t.staff('admin'); support = await t.staff('support'); viewer = await t.staff('viewer'); });
afterAll(async () => { await t.close(); });

const id = (n: number) => `01a1ef97-0000-7000-8000-${String(n).padStart(12, '0')}`;
async function cell(code: string, o: { kind?: string; tier?: string; clientName?: string } = {}) {
  const client = (await t.call('POST', '/clients', support.token, { name: o.clientName ?? `Client ${code}`, tier: o.tier ?? 'hybrid' })).json;
  const site = (await t.call('POST', '/sites', support.token, { clientId: client.id, code, name: code, kind: o.kind ?? 'pooled' })).json;
  const token = (await t.call('POST', `/sites/${site.id}/agent-token`, admin.token)).json.token as string;
  return { id: site.id as string, token, client: client.id as string };
}
const tenant = (n: number, slug: string, o: { status?: string; users?: number; docs?: number; licence?: object } = {}) => ({ id: id(n), slug, name: `${slug} Pvt Ltd`, status: o.status ?? 'active', usage: { users: o.users ?? 3, companies: 1, documents30d: o.docs ?? 40, events30d: 200, lastActivityAt: new Date().toISOString() }, licence: o.licence ?? { restricted: true, plan: 'Hybrid', modules: ['sales'], limits: { users: 5 }, readOnly: false, expiresAt: null } });
const report = (token: string, items: object[]) => t.call('POST', '/agent/tenants', token, { items });
const beat = (token: string) => t.call('POST', '/agent/heartbeat', token, { version: '1.0.0', db: { ok: true }, backup: { lastBaseBackupAt: new Date().toISOString(), lastWalShippedAt: new Date().toISOString(), walQueueBytes: 0 }, disk: { freePercent: 70 }, tunnel: { up: true } });
const good = { ok: true, checks: [{ key: 'ledger_balanced', label: 'Ledger balances', status: 'pass', detail: 'ok' }] };

describe('tenants across cells', () => {
  it('collects tenants from every cell and lets staff search and filter them', async () => {
    const a = await cell('POOL-A'); const b = await cell('POOL-B'); const solo = await cell('SOLO-1', { kind: 'onprem', clientName: 'Pune Traders' });
    await Promise.all([beat(a.token), beat(b.token), beat(solo.token)]);
    expect((await report(a.token, [tenant(1, 'acme'), tenant(2, 'bharat', { users: 5 })])).json).toMatchObject({ ok: true, tenants: 2 });
    await report(b.token, [tenant(3, 'carnatic', { licence: { restricted: false, plan: null, modules: [], limits: {}, readOnly: false, expiresAt: null } })]);
    await report(solo.token, [tenant(4, 'pune-traders', { status: 'suspended' })]);
    const all = (await t.call('GET', '/tenants', viewer.token)).json;
    expect(all.total).toBe(4);
    expect(all.items.map((x: { slug: string }) => x.slug).sort()).toEqual(['acme', 'bharat', 'carnatic', 'pune-traders']);
    expect(all.items.find((x: { slug: string }) => x.slug === 'acme')).toMatchObject({ cell: { code: 'POOL-A', kind: 'pooled' }, client: { tier: 'hybrid' }, licence: { plan: 'Hybrid' }, health: 'healthy' });
    const q = async (qs: string) => ((await t.call('GET', `/tenants?${qs}`, viewer.token)).json.items as { slug: string }[]).map((x) => x.slug).sort();
    expect(await q('q=ACME')).toEqual(['acme']); expect(await q('q=pune')).toEqual(['pune-traders']);
    expect(await q('status=suspended')).toEqual(['pune-traders']); expect(await q('cell=POOL-A')).toEqual(['acme', 'bharat']); expect(await q('licence=none')).toEqual(['carnatic']);
    expect(await q('health=attention')).toEqual(expect.arrayContaining(['bharat', 'pune-traders'])); // bharat is at its user limit, one is suspended
  });

  it('judges each tenant from its cell, its checks and its licence, and lists what needs attention', async () => {
    const a = await cell('JUDGE-A');
    await beat(a.token);
    await report(a.token, [tenant(10, 'fine'), tenant(11, 'broken'), tenant(12, 'expiring', { licence: { restricted: true, plan: 'Hybrid', modules: ['sales'], limits: {}, readOnly: false, expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString() } })]);
    await t.call('POST', '/agent/validations', a.token, { tenantId: id(10), at: new Date().toISOString(), ...good });
    await t.call('POST', '/agent/validations', a.token, { tenantId: id(11), at: new Date().toISOString(), ok: false, checks: [{ key: 'invoice_series', label: 'Every GST registration has this year\'s tax-invoice series', status: 'fail', detail: '1 of 1 missing a series: invoicing will fail' }] });
    const view = async (n: number) => (await t.call('GET', `/tenants/${id(n)}`, viewer.token)).json;
    expect(await view(10)).toMatchObject({ health: 'healthy', validations: { ok: true } });
    expect(await view(11)).toMatchObject({ health: 'critical' });
    expect((await view(11)).reasons[0].text).toMatch(/invoicing will fail/);
    const alerts = (await t.call('GET', '/alerts', viewer.token)).json;
    expect(alerts.critical).toBeGreaterThan(0);
    expect(alerts.items[0].level).toBe('critical');
    expect(alerts.items.some((x: { subject: string; text: string }) => x.subject === 'broken Pvt Ltd' && /invoicing will fail/.test(x.text))).toBe(true);
    // the cell going silent makes all its tenants critical
    await t.pool.query("UPDATE site_status SET last_seen_at = now() - interval '2 hours' WHERE site_id = $1", [a.id]);
    expect((await view(10)).health).toBe('critical');
    expect((await view(10)).reasons.map((r: { text: string }) => r.text).join(' ')).toMatch(/Cell silent/);
  });

  it('replaces a cell\'s tenant list each time, and refuses a tenant that another cell already reports', async () => {
    const a = await cell('REPL-A'); const b = await cell('REPL-B');
    await report(a.token, [tenant(20, 'one'), tenant(21, 'two')]);
    await report(a.token, [tenant(20, 'one')]);
    expect(((await t.call('GET', '/tenants?cell=REPL-A', viewer.token)).json.items as unknown[]).length).toBe(1);
    expect((await report(b.token, [tenant(20, 'one')])).json.code).toBe('tenant_elsewhere');
    expect((await t.call('POST', '/agent/tenants', a.token, { items: [{ id: 'bad' }] })).status).toBe(422);
    expect((await t.call('POST', '/agent/tenants', viewer.token, { items: [] })).status).toBe(401);
  });

  it('gives the overview counts, and is read-only for viewers', async () => {
    const o = (await t.call('GET', '/overview', viewer.token)).json;
    expect(o.cells.total).toBeGreaterThanOrEqual(5); expect(o.tenants.total).toBeGreaterThanOrEqual(7);
    expect(o.tenants.byStatus).toMatchObject({ active: expect.any(Number), suspended: expect.any(Number) });
    expect(o.tenants.licencesExpiringSoon).toBeGreaterThanOrEqual(1); expect(o.tenants.unlicensed).toBeGreaterThanOrEqual(1);
    expect(o.alerts.top.length).toBeGreaterThan(0); expect(o.usage.users).toBeGreaterThan(0);
    expect((await t.call('GET', '/overview', null)).status).toBe(401);
  });
});

describe('licences and commands per tenant', () => {
  it('issues a licence for one tenant of a pooled cell, and serves each tenant its own', async () => {
    const a = await cell('LIC-POOL');
    await report(a.token, [tenant(30, 'alpha'), tenant(31, 'beta')]);
    const l1 = await t.call('POST', `/tenants/${id(30)}/licences`, admin.token, { plan: 'Business', modules: ['sales', 'inventory'], limits: { users: 10 } });
    const l2 = await t.call('POST', `/tenants/${id(31)}/licences`, admin.token, { plan: 'Starter', modules: ['sales'] });
    expect(l1.status).toBe(201); expect(l1.json.licence).toMatchObject({ tenantId: id(30), plan: 'Business', licenceId: 'LIC-ALPHA-001' }); expect(l2.json.licence.tenantId).toBe(id(31));
    const served = (await t.call('GET', '/agent/licences', a.token)).json.items as { tenantId: string; licence: { plan: string } }[];
    expect(served.map((s) => [s.tenantId, s.licence.plan]).sort()).toEqual([[id(30), 'Business'], [id(31), 'Starter']]);
    expect((await t.call('POST', `/tenants/${id(30)}/licences`, support.token, { plan: 'x', modules: ['sales'] })).status).toBe(403);
    expect((await t.call('POST', `/tenants/${id(30)}/licences`, admin.token, { plan: 'x', modules: ['pos'] })).json.code).toBe('module_dependency');
    expect((await t.call('POST', `/tenants/${id(999)}/licences`, admin.token, { plan: 'x', modules: ['sales'] })).status).toBe(404);
    expect((await t.call('POST', `/tenants/${id(30)}/licences`, admin.token, { plan: 'Business', modules: ['sales'] })).json.licence.licenceId).toBe('LIC-ALPHA-002');
  });

  it('queues work for the cell: anyone in support can ask for a check, only an admin can suspend, and the agent reports back', async () => {
    const a = await cell('CMD-A');
    await report(a.token, [tenant(40, 'gamma')]);
    const v = await t.call('POST', `/tenants/${id(40)}/commands`, support.token, { type: 'validate' });
    expect(v.status).toBe(202);
    expect((await t.call('POST', `/tenants/${id(40)}/commands`, support.token, { type: 'validate' })).json.code).toBe('already_requested');
    expect((await t.call('POST', `/tenants/${id(40)}/commands`, viewer.token, { type: 'validate' })).status).toBe(403);
    expect((await t.call('POST', `/tenants/${id(40)}/commands`, support.token, { type: 'suspend', reason: 'Unpaid' })).status).toBe(403);
    expect((await t.call('POST', `/tenants/${id(40)}/commands`, admin.token, { type: 'suspend' })).json.code).toBe('reason_required');
    expect((await t.call('POST', `/tenants/${id(40)}/commands`, admin.token, { type: 'suspend', reason: 'Unpaid invoice' })).status).toBe(202);
    const got = (await t.call('GET', '/agent/commands', a.token)).json.items as { id: string; type: string; tenantId: string; payload: { reason: string | null } }[];
    expect(got.map((c) => c.type).sort()).toEqual(['suspend', 'validate']); expect(got.find((c) => c.type === 'suspend')?.payload.reason).toBe('Unpaid invoice');
    expect((await t.call('GET', '/agent/commands', a.token)).json.items).toEqual([]); // handed out once
    for (const c of got) expect((await t.call('POST', `/agent/commands/${c.id}/result`, a.token, { ok: c.type === 'validate', message: c.type === 'validate' ? 'checked' : 'the server refused' })).status).toBe(200);
    expect((await t.call('POST', `/agent/commands/${got[0]?.id}/result`, a.token, { ok: true })).status).toBe(404); // already finished
    const detail = (await t.call('GET', `/tenants/${id(40)}`, viewer.token)).json;
    expect(detail.commands.map((c: { type: string; status: string }) => [c.type, c.status]).sort()).toEqual([['suspend', 'failed'], ['validate', 'done']]);
    const log = (await t.call('GET', '/audit', admin.token)).json.items as { action: string }[];
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['tenant.validate_requested', 'tenant.suspend_requested', 'tenant.validate_done', 'tenant.suspend_failed']));
    // another cell's agent cannot touch it
    const other = await cell('CMD-B');
    expect((await t.call('POST', `/agent/commands/${got[0]?.id}/result`, other.token, { ok: true })).status).toBe(404);
  });
});
