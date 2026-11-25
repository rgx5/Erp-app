import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer; let graph: Server; let graphBase = ''; let kit: ReturnType<typeof shopKit>;
const supers = superPool();
const graphLeads = new Map<string, unknown>(); let graphDown = false;
beforeAll(async () => {
  graph = createServer((req, res) => {
    const id = new URL(req.url ?? '', 'http://x').pathname.slice(1);
    if (graphDown) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Invalid OAuth access token.' } })); return; }
    const lead = graphLeads.get(id);
    res.writeHead(lead ? 200 : 404, { 'content-type': 'application/json' }); res.end(JSON.stringify(lead ?? { error: { message: 'Unsupported get request' } }));
  });
  await new Promise<void>((r) => graph.listen(0, '127.0.0.1', r));
  graphBase = `http://127.0.0.1:${(graph.address() as { port: number }).port}`;
  server = await startServer({ META_GRAPH_BASE: graphBase });
  kit = shopKit(server, supers);
});
afterAll(async () => { await server.close(); await supers.end(); await new Promise((r) => graph.close(r)); });

const PW = 'a-long-passphrase-9';
let n = 0;
const lead = (t: string, body: object, status = 201) => { return call(server, 'POST', '/v1/leads', { tenant: t, body }).then((r) => { expect(r.status, JSON.stringify(r.json)).toBe(status); return r.json; }); };
const stagesOf = async (t: string) => ((await call(server, 'GET', '/v1/leads/settings', { tenant: t })).json.stages as { id: string; name: string; kind: string }[]);
const connector = async (t: string, body: object) => ok(await call(server, 'POST', '/v1/leads/connectors', { tenant: t, body }));
const sign = (secret: string, raw: string) => 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');

describe('leads: the pipeline', () => {
  it('starts with a standard pipeline, keeps a person once, runs the response clock and follow-ups, and loses only with a reason', async () => {
    const s = await kit.shop('Leads Co'); const t = s.tenant;
    const a = await lead(t, { name: 'Asha Rao', phone: '+91 98100 00001', email: 'asha@x.in', city: 'Pune', interest: 'Rooftop solar', fields: { monthly_bill: '4500' } });
    expect(a).toMatchObject({ leadNo: 'L-00001', status: 'open', source: 'manual', overdue: false });
    const stages = await stagesOf(t);
    expect(stages.map((x) => x.name)).toEqual(['New', 'Contacted', 'Site survey', 'Proposal sent', 'Negotiation', 'Won', 'Lost']);
    expect(a.stageId).toBe(stages[0]?.id);
    // the same phone in another spelling is the same person
    const dup = await call(server, 'POST', '/v1/leads', { tenant: t, body: { name: 'Asha R', phone: '09810000001' } });
    expect(dup.status).toBe(409); expect(dup.json.code).toBe('duplicate_lead'); expect(dup.json.lead.id).toBe(a.id);
    await lead(t, { name: 'Asha R', phone: '09810000001', allowDuplicate: true });
    const noContact = await call(server, 'POST', '/v1/leads', { tenant: t, body: { name: 'No contact' } }); expect(noContact.status).toBe(422);

    // doing something with the lead stops the response clock; a task sets the follow-up
    let d = ok(await call(server, 'GET', `/v1/leads/${a.id}`, { tenant: t }), 200);
    expect(d.firstResponseAt).toBeNull();
    ok(await call(server, 'POST', `/v1/leads/${a.id}/activities`, { tenant: t, body: { kind: 'call', body: 'Spoke, wants 5 kW' } }));
    const due = new Date(Date.now() + 86_400_000).toISOString();
    const task = ok(await call(server, 'POST', `/v1/leads/${a.id}/activities`, { tenant: t, body: { kind: 'task', body: 'Site survey', dueAt: due } }));
    expect((await call(server, 'POST', `/v1/leads/${a.id}/activities`, { tenant: t, body: { kind: 'task', body: 'No date' } })).status).toBe(422);
    d = ok(await call(server, 'GET', `/v1/leads/${a.id}`, { tenant: t }), 200);
    expect(d.firstResponseAt).not.toBeNull(); expect(new Date(d.nextFollowUpAt).getTime()).toBe(new Date(due).getTime());
    ok(await call(server, 'POST', `/v1/leads/${a.id}/activities/${task.id}/done`, { tenant: t }), 200);
    expect((ok(await call(server, 'GET', `/v1/leads/${a.id}`, { tenant: t }), 200)).nextFollowUpAt).toBeNull();

    // stages: moving on is free, losing needs a reason
    const survey = stages.find((x) => x.name === 'Site survey') as { id: string }; const lost = stages.find((x) => x.kind === 'lost') as { id: string }; const won = stages.find((x) => x.kind === 'won') as { id: string };
    ok(await call(server, 'POST', `/v1/leads/${a.id}/stage`, { tenant: t, body: { stageId: survey.id } }), 200);
    expect((await call(server, 'POST', `/v1/leads/${a.id}/stage`, { tenant: t, body: { stageId: lost.id } })).status).toBe(422);
    ok(await call(server, 'POST', `/v1/leads/${a.id}/stage`, { tenant: t, body: { stageId: lost.id, lostReason: 'Price too high' } }), 200);
    d = ok(await call(server, 'GET', `/v1/leads/${a.id}`, { tenant: t }), 200);
    expect(d).toMatchObject({ status: 'lost', lostReason: 'Price too high' });
    expect(d.activities.map((x: { kind: string }) => x.kind)).toEqual(expect.arrayContaining(['system', 'call', 'task', 'stage']));
    ok(await call(server, 'POST', `/v1/leads/${a.id}/stage`, { tenant: t, body: { stageId: won.id } }), 200);
    expect(ok(await call(server, 'GET', '/v1/leads?status=won', { tenant: t }), 200).items).toHaveLength(1);
    const counts = ok(await call(server, 'GET', '/v1/leads/counts', { tenant: t }), 200);
    expect(counts.today).toBe(2); expect(counts.unassigned).toBe(1);
    // search by a number in any spelling
    expect(ok(await call(server, 'GET', '/v1/leads?q=%2B91%2098100%2000001', { tenant: t }), 200).items.length).toBeGreaterThanOrEqual(1);
    // edit and merge
    ok(await call(server, 'PATCH', `/v1/leads/${a.id}`, { tenant: t, body: { city: 'Nashik', valueEstimate: '350000' } }), 200);
    const all = ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items as { id: string; leadNo: string }[];
    const other = all.find((x) => x.id !== a.id) as { id: string };
    ok(await call(server, 'POST', `/v1/leads/${other.id}/merge`, { tenant: t, body: { intoId: a.id } }), 200);
    expect(ok(await call(server, 'GET', `/v1/leads/${other.id}`, { tenant: t }), 200)).toMatchObject({ status: 'lost', lostReason: 'Duplicate', duplicateOf: a.id });
  });

  it('shares leads round the team by rule, and the stages can be renamed but not emptied', async () => {
    const s = await kit.shop('Leads RR Co'); const t = s.tenant;
    const mk = async (): Promise<string> => { const r = ok(await call(server, 'POST', '/v1/roles', { tenant: t, body: { name: `sales-${++n}`, permissions: ['leads:read', 'leads:write'] } })); return ok(await call(server, 'POST', '/v1/users', { tenant: t, body: { email: `u${++n}@rr.example.com`, displayName: `Rep ${n}`, password: PW, roleIds: [r.id] } })).id as string; };
    const [u1, u2] = [await mk(), await mk()];
    await call(server, 'GET', '/v1/leads/settings', { tenant: t });
    ok(await call(server, 'PUT', '/v1/leads/settings', { tenant: t, body: { assignmentMode: 'round_robin', members: [u1, u2], slaMinutes: 15, lostReasons: ['Price', 'Other'], rules: [{ match: { city: ['Mumbai'] }, users: [u2] }] } }), 200);
    const owners: string[] = [];
    for (const [i, city] of ['Pune', 'Pune', 'Pune', 'Mumbai'].entries()) owners.push((await lead(t, { name: `L${i}`, phone: `98200000${i}0`, city })).ownerId);
    expect(owners).toEqual([u1, u2, u1, u2]); // the Mumbai rule sends the last one to the second person
    expect((await call(server, 'PUT', '/v1/leads/settings', { tenant: t, body: { assignmentMode: 'round_robin', members: ['01a1f6f5-0000-7000-8000-000000000001'], slaMinutes: 15, lostReasons: ['x'], rules: [] } })).status).toBe(422);
    // a first response in time, one overdue
    const first = ok(await call(server, 'GET', '/v1/leads?limit=10', { tenant: t }), 200).items as { id: string; slaDueAt: string }[];
    await supers.query("UPDATE erp.leads SET sla_due_at = now() - interval '5 minutes' WHERE id = $1", [first[0]?.id]);
    expect(ok(await call(server, 'GET', '/v1/leads?overdue=true', { tenant: t }), 200).items).toHaveLength(1);
    expect(ok(await call(server, 'GET', '/v1/leads/counts', { tenant: t }), 200).overdue).toBe(1);
    // stages
    const stages = await stagesOf(t);
    const renamed = stages.map((x) => ({ id: x.id, kind: x.kind, name: x.name === 'Site survey' ? 'Survey booked' : x.name }));
    expect(ok(await call(server, 'PUT', '/v1/leads/stages', { tenant: t, body: { stages: renamed } }), 200).stages.map((x: { name: string }) => x.name)).toContain('Survey booked');
    expect((await call(server, 'PUT', '/v1/leads/stages', { tenant: t, body: { stages: renamed.filter((x) => x.kind !== 'lost') } })).status).toBe(422);
    expect((await call(server, 'PUT', '/v1/leads/stages', { tenant: t, body: { stages: renamed.filter((x) => x.name !== 'New') } })).status).toBe(409); // leads are still in New
  });
});

describe('leads: connectors', () => {
  it('a website form: three ways to post, allowed sites, a hidden trap for bots, repeat enquiries, a switch-off', async () => {
    const s = await kit.shop('Leads Web Co'); const t = s.tenant;
    const c = await connector(t, { kind: 'website', name: 'Solar site', allowedDomains: ['solar.example.in'], defaultCampaign: 'Website' });
    expect(c.path).toMatch(/^\/v1\/ingest\/website\/[A-Za-z0-9_-]{24}$/);
    const hdr = { origin: 'https://www.solar.example.in' };
    const json = await call(server, 'POST', c.path, { body: { name: 'Meena', phone: '98100 00022', city: 'Nashik', utm_source: 'google', gclid: 'G1', 'Monthly bill': '3000', consent: 'yes' }, headers: hdr });
    expect(json.status).toBe(200); expect(json.json).toEqual({ ok: true });
    const form = await call(server, 'POST', c.path, { rawBody: 'name=Kiran+Shah&mobile=9810000033&zip=380001', headers: { ...hdr, 'content-type': 'application/x-www-form-urlencoded' } });
    expect(form.status, JSON.stringify(form.json)).toBe(200);
    const plain = await call(server, 'POST', c.path, { rawBody: JSON.stringify({ name: 'Ravi', email: 'ravi@x.in' }), headers: { ...hdr, 'content-type': 'text/plain' } });
    expect(plain.status, JSON.stringify(plain.json)).toBe(200);
    const items = ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items as { name: string; source: string; campaign: string | null; clickId: string | null; pincode: string | null; fields: Record<string, string>; consent: boolean; connectorId: string }[];
    expect(items).toHaveLength(3);
    const meena = items.find((x) => x.name === 'Meena');
    expect(meena).toMatchObject({ source: 'website', campaign: 'Website', clickId: 'G1', consent: true, connectorId: c.id }); expect(meena?.fields['monthly_bill']).toBe('3000');
    expect(items.find((x) => x.name === 'Kiran Shah')?.pincode).toBe('380001');
    // refusals
    expect((await call(server, 'POST', c.path, { body: { name: 'X', phone: '9810000044' }, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call(server, 'POST', c.path, { body: { name: 'X', phone: '9810000044' } })).status).toBe(403); // no origin at all, but sites are restricted
    expect((await call(server, 'POST', c.path, { body: { name: 'No way to call' }, headers: hdr })).status).toBe(422);
    expect((await call(server, 'POST', c.path, { body: { name: 'Bot', phone: '9810000055', _hp: 'http://spam' }, headers: hdr })).status).toBe(200); // looks accepted, nothing made
    expect((await call(server, 'POST', '/v1/ingest/website/not-a-real-key-at-all-1234', { body: { name: 'X', phone: '9810000044' } })).status).toBe(404);
    expect(ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items).toHaveLength(3);
    // the same person again: noted on the first lead, not a second one
    await call(server, 'POST', c.path, { body: { name: 'Meena J', phone: '+91 9810000022' }, headers: hdr });
    const again = ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items as { name: string; enquiryCount: number }[];
    expect(again).toHaveLength(3); expect(again.find((x) => x.name === 'Meena')?.enquiryCount).toBe(2);
    // the log and counts on the connector
    const log = ok(await call(server, 'GET', `/v1/leads/connectors/${c.id}/deliveries`, { tenant: t }), 200).items as { outcome: string }[];
    expect(log.map((x) => x.outcome)).toEqual(expect.arrayContaining(['created', 'duplicate', 'rejected']));
    const listed = (ok(await call(server, 'GET', '/v1/leads/connectors', { tenant: t }), 200).items as { id: string; leadCount: number }[]).find((x) => x.id === c.id);
    expect(listed?.leadCount).toBe(3);
    // switched off
    ok(await call(server, 'PATCH', `/v1/leads/connectors/${c.id}`, { tenant: t, body: { status: 'paused' } }), 200);
    expect((await call(server, 'POST', c.path, { body: { name: 'Late', phone: '9810000066' }, headers: hdr })).status).toBe(403);
    // the test button makes a lead through the real path
    ok(await call(server, 'PATCH', `/v1/leads/connectors/${c.id}`, { tenant: t, body: { status: 'active', allowedDomains: [] } }), 200);
    ok(await call(server, 'POST', `/v1/leads/connectors/${c.id}/test`, { tenant: t }), 200);
    expect((ok(await call(server, 'GET', '/v1/leads?q=Test%20lead', { tenant: t }), 200).items as unknown[]).length).toBe(1);
  });

  it('Google lead forms: the key must match, a test post makes nothing, a real one makes a lead with its campaign', async () => {
    const s = await kit.shop('Leads Google Co'); const t = s.tenant;
    const c = await connector(t, { kind: 'google', name: 'Google solar' });
    expect(c.config.googleKey).toBeTruthy();
    const body = (key: string, extra: object = {}) => ({ google_key: key, lead_id: 'gl-1', campaign_id: 123, gcl_id: 'GCL9', form_id: 7, user_column_data: [{ column_id: 'FULL_NAME', string_value: 'Dev Patel' }, { column_id: 'PHONE_NUMBER', string_value: '+919810000077' }, { column_id: 'POSTAL_CODE', string_value: '390001' }, { column_id: 'QUESTION_1', column_name: 'Roof type', string_value: 'RCC' }], ...extra });
    expect((await call(server, 'POST', c.path, { body: body('wrong-key-wrong-key-12') })).status).toBe(403);
    expect((await call(server, 'POST', c.path, { body: body(c.config.googleKey, { is_test: true }) })).status).toBe(200);
    expect(ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items).toHaveLength(0);
    expect((await call(server, 'POST', c.path, { body: body(c.config.googleKey) })).json).toEqual({});
    const items = ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items as { name: string; source: string; campaign: string; clickId: string; pincode: string; fields: Record<string, string> }[];
    expect(items).toHaveLength(1); expect(items[0]).toMatchObject({ name: 'Dev Patel', source: 'google', campaign: '123', clickId: 'GCL9', pincode: '390001' }); expect(items[0]?.fields['roof_type']).toBe('RCC');
    await call(server, 'POST', c.path, { body: body(c.config.googleKey) }); // Google sends it again: still one
    expect(ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items).toHaveLength(1);
  });

  it('Meta lead ads: the address is verified, calls are signed, the lead is read back from Meta, and a failure is logged for a retry', async () => {
    const s = await kit.shop('Leads Meta Co'); const t = s.tenant;
    const c = await connector(t, { kind: 'meta', name: 'Facebook solar', pageId: 'PAGE1', pageAccessToken: 'EAAB-page-token', appSecret: 'app-secret-value' });
    expect(c.config).toMatchObject({ hasPageToken: true, hasAppSecret: true }); expect(c.config.verifyToken).toBeTruthy();
    expect((await call(server, 'POST', '/v1/leads/connectors', { tenant: t, body: { kind: 'meta', name: 'No token' } })).status).toBe(422);
    // Meta's one-off check of the address
    const verify = await fetch(`${server.base}${c.path}?hub.mode=subscribe&hub.verify_token=${c.config.verifyToken}&hub.challenge=12345`);
    expect(verify.status).toBe(200); expect(await verify.text()).toBe('12345');
    expect((await fetch(`${server.base}${c.path}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status).toBe(403);

    graphLeads.set('LG1', { id: 'LG1', created_time: '2026-11-24T10:00:00+0000', campaign_name: 'Solar Q4', adset_name: 'Pune 25-55', ad_name: 'Rooftop video', form_id: 'F9', field_data: [{ name: 'full_name', values: ['Neha Joshi'] }, { name: 'phone_number', values: ['+919810000088'] }, { name: 'city', values: ['Nashik'] }, { name: 'what_is_your_monthly_electricity_bill?', values: ['₹3000 - 5000'] }] });
    const hook = (id: string) => JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', time: 1, changes: [{ field: 'leadgen', value: { leadgen_id: id, page_id: 'PAGE1', form_id: 'F9' } }] }] });
    const post = (raw: string, secret = 'app-secret-value') => call(server, 'POST', c.path, { rawBody: raw, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(secret, raw) } });
    expect((await post(hook('LG1'), 'the-wrong-secret')).status).toBe(403);
    expect((await call(server, 'POST', c.path, { rawBody: hook('LG1'), headers: { 'content-type': 'application/json' } })).status).toBe(403); // unsigned
    expect(ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items).toHaveLength(0);
    expect((await post(hook('LG1'))).status).toBe(200);
    const items = ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items as { name: string; source: string; campaign: string; adset: string; ad: string; formName: string; city: string; fields: Record<string, string> }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Neha Joshi', source: 'meta', campaign: 'Solar Q4', adset: 'Pune 25-55', ad: 'Rooftop video', formName: 'F9', city: 'Nashik' });
    expect(items[0]?.fields['what_is_your_monthly_electricity_bill']).toBe('₹3000 - 5000');
    expect((await post(hook('LG1'))).status).toBe(200); // Meta retries: still one lead
    expect(ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items).toHaveLength(1);
    // another page is ignored
    const other = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE2', changes: [{ field: 'leadgen', value: { leadgen_id: 'LG1', page_id: 'PAGE2' } }] }] });
    expect((await post(other)).status).toBe(200);
    // Meta cannot be reached or the token has expired: an error answer (so Meta retries) and the reason is kept
    graphDown = true;
    expect((await post(hook('LG2'))).status).toBe(502);
    graphDown = false;
    const listed = (ok(await call(server, 'GET', '/v1/leads/connectors', { tenant: t }), 200).items as { id: string; lastError: string | null }[]).find((x) => x.id === c.id);
    expect(listed?.lastError).toMatch(/Invalid OAuth access token/);
    graphLeads.set('LG2', { id: 'LG2', campaign_name: 'Solar Q4', field_data: [{ name: 'full_name', values: ['Omar'] }, { name: 'phone_number', values: ['9810000099'] }] });
    expect((await post(hook('LG2'))).status).toBe(200);
    expect(ok(await call(server, 'GET', '/v1/leads', { tenant: t }), 200).items).toHaveLength(2);
    // the stored token is sealed, not readable in the table
    const row = (await supers.query('SELECT secret_sealed, config FROM erp.lead_connectors WHERE id = $1', [c.id])).rows[0];
    expect(row.secret_sealed).toMatch(/^v1\./); expect(JSON.stringify(row)).not.toContain('EAAB-page-token'); expect(JSON.stringify(row)).not.toContain('app-secret-value');
  });
});

describe('leads: customers, money and the rest', () => {
  it('links a lead to a customer, then reports leads, wins, revenue and cost per lead by source', async () => {
    const s = await kit.shop('Leads Money Co'); const t = s.tenant;
    const a = await lead(t, { name: 'Asha Traders', phone: '9810000101', source: 'meta', campaign: 'Solar Q4' });
    await lead(t, { name: 'Second', phone: '9810000102', source: 'meta', campaign: 'Solar Q4' }); await lead(t, { name: 'Third', phone: '9810000103', source: 'google', campaign: 'Search' });
    await supers.query("UPDATE erp.leads SET created_at = '2025-04-05' WHERE tenant_id = $1", [t]); // the books of this test business start in April 2025
    expect((await call(server, 'POST', `/v1/leads/${a.id}/link-customer`, { tenant: t, body: { partyId: s.cust.consumer } })).status).toBe(200);
    expect((await call(server, 'POST', `/v1/leads/${a.id}/link-customer`, { tenant: t, body: { partyId: s.cust.local } })).status).toBe(409); // already linked
    ok(await call(server, 'POST', '/v1/sales/invoices', { tenant: t, body: { companyId: s.companyId, gstRegistrationId: s.regId, invoiceDate: '2025-04-10', customerId: s.cust.consumer, lines: [{ itemId: s.item.widget, quantity: '1', unitPrice: '1000', warehouseId: s.wh }] } }));
    const stages = await stagesOf(t); const won = stages.find((x) => x.kind === 'won') as { id: string };
    ok(await call(server, 'POST', `/v1/leads/${a.id}/stage`, { tenant: t, body: { stageId: won.id } }), 200);
    const today = '2025-04-06'; const upto = '2025-12-31';
    ok(await call(server, 'POST', '/v1/leads/ad-spend', { tenant: t, body: { rows: [{ date: today, source: 'meta', campaign: 'Solar Q4', amount: '1000' }, { date: today, source: 'google', campaign: 'Search', amount: '600' }] } }), 200);
    ok(await call(server, 'POST', '/v1/leads/ad-spend', { tenant: t, body: { rows: [{ date: today, source: 'meta', campaign: 'Solar Q4', amount: '1200' }] } }), 200); // corrected, not doubled
    const rep = ok(await call(server, 'GET', `/v1/leads/reports/summary?from=2025-04-01&to=${upto}`, { tenant: t }), 200);
    const meta = rep.items.find((x: { source: string }) => x.source === 'meta');
    expect(meta).toMatchObject({ campaign: 'Solar Q4', leads: 2, won: 1, spend: 1200, costPerLead: 600, costPerWon: 1200, winRate: 100 });
    expect(meta.revenue).toBeCloseTo(1180, 2);
    expect(rep.totals).toMatchObject({ leads: 3, won: 1, spend: 1800 });
    expect(rep.funnel.map((f: { name: string; count: number }) => f.name)).toContain('Won'); expect(rep.response.waiting).toBe(2);
    const spend = ok(await call(server, 'GET', `/v1/leads/ad-spend?from=2025-04-01&to=${upto}`, { tenant: t }), 200).items as { id: string; amount: string }[];
    expect(spend).toHaveLength(2);
    ok(await call(server, 'DELETE', `/v1/leads/ad-spend/${spend[0]?.id}`, { tenant: t }), 200);
    expect((await call(server, 'GET', `/v1/leads/reports/summary?from=${today}&to=2020-01-01`, { tenant: t })).status).toBe(422);
  });

  it('keeps businesses apart, needs a sign-in and the right permission', async () => {
    const a = await kit.shop('Leads A Co'); const b = await kit.shop('Leads B Co');
    const mine = await lead(a.tenant, { name: 'Private', phone: '9810000201' });
    expect((await call(server, 'GET', `/v1/leads/${mine.id}`, { tenant: b.tenant })).status).toBe(404);
    expect((await call(server, 'POST', `/v1/leads/${mine.id}/assign`, { tenant: b.tenant, body: { ownerId: null } })).status).toBe(404);
    expect(ok(await call(server, 'GET', '/v1/leads', { tenant: b.tenant }), 200).items).toHaveLength(0);
    expect((await call(server, 'GET', '/v1/leads')).status).toBe(401);
    // a connector's address of one business never lets another business's data in
    const c = await connector(a.tenant, { kind: 'website', name: 'A site' });
    await call(server, 'POST', c.path, { body: { name: 'Via A', phone: '9810000202' } });
    expect(ok(await call(server, 'GET', '/v1/leads', { tenant: b.tenant }), 200).items).toHaveLength(0);
    expect(ok(await call(server, 'GET', '/v1/leads/connectors', { tenant: b.tenant }), 200).items).toHaveLength(0);
    // someone who may only read cannot create, and cannot see the connectors
    const role = ok(await call(server, 'POST', '/v1/roles', { tenant: a.tenant, body: { name: `viewer-${++n}`, permissions: ['leads:read'] } }));
    const email = `v${++n}@viewer.example.com`;
    ok(await call(server, 'POST', '/v1/users', { tenant: a.tenant, body: { email, displayName: 'Viewer', password: PW, roleIds: [role.id] } }));
    const slug = ((await supers.query('SELECT slug FROM erp.tenants WHERE id = $1', [a.tenant])).rows[0] as { slug: string }).slug;
    const token = (await call(server, 'POST', '/v1/auth/login', { body: { tenant: slug, email, password: PW } })).json.accessToken as string;
    expect((await call(server, 'GET', '/v1/leads', { token })).status).toBe(200);
    expect(ok(await call(server, 'GET', '/v1/leads', { token }), 200).items).toHaveLength(0); // read, but not read-all: none of these are theirs
    expect((await call(server, 'GET', `/v1/leads/${mine.id}`, { token })).status).toBe(404);
    expect((await call(server, 'GET', '/v1/leads/reports/summary?from=2025-01-01&to=2025-12-31', { token })).status).toBe(403);
    expect((await call(server, 'POST', '/v1/leads', { token, body: { name: 'X', phone: '9810000203' } })).status).toBe(403);
    expect((await call(server, 'GET', '/v1/leads/connectors', { token })).status).toBe(403);
  });
});

describe('leads: who sees which leads', () => {
  it('a person with leads:read sees only their own leads and their territory; read-all sees everything', async () => {
    const s = await kit.shop('Leads Scope Co'); const t = s.tenant;
    const slug = ((await supers.query('SELECT slug FROM erp.tenants WHERE id = $1', [t])).rows[0] as { slug: string }).slug;
    const person = async (perms: string[]) => {
      const role = ok(await call(server, 'POST', '/v1/roles', { tenant: t, body: { name: `r-${++n}`, permissions: perms } }));
      const email = `p${++n}@scope.example.com`;
      const u = ok(await call(server, 'POST', '/v1/users', { tenant: t, body: { email, displayName: `P${n}`, password: PW, roleIds: [role.id] } }));
      return { id: u.id as string, token: (await call(server, 'POST', '/v1/auth/login', { body: { tenant: slug, email, password: PW } })).json.accessToken as string };
    };
    const pune = await person(['leads:read', 'leads:write']); const mumbai = await person(['leads:read', 'leads:write']); const boss = await person(['leads:read', 'leads:read_all', 'leads:write']);
    await lead(t, { name: 'Pune one', phone: '9820000001', city: 'Pune' }); await lead(t, { name: 'Pune two', phone: '9820000002', city: 'Pune', pincode: '411001' }); await lead(t, { name: 'Mumbai one', phone: '9820000003', city: 'Mumbai', pincode: '400001' }); await lead(t, { name: 'Delhi one', phone: '9820000004', city: 'Delhi' });
    ok(await call(server, 'PUT', '/v1/leads/settings', { tenant: t, body: { assignmentMode: 'manual', members: [], slaMinutes: 30, lostReasons: ['Other'], rules: [], territories: [{ users: [pune.id], cities: ['pune'] }, { users: [mumbai.id], pincodePrefix: ['400'] }] } }), 200);
    const names = async (token: string) => (ok(await call(server, 'GET', '/v1/leads', { token }), 200).items as { name: string }[]).map((x) => x.name).sort();
    expect(await names(pune.token)).toEqual(['Pune one', 'Pune two']); expect(await names(mumbai.token)).toEqual(['Mumbai one']); expect(await names(boss.token)).toHaveLength(4);
    expect((ok(await call(server, 'GET', '/v1/leads/counts', { token: pune.token }), 200)).today).toBe(2);
    const all = ok(await call(server, 'GET', '/v1/leads', { token: boss.token }), 200).items as { id: string; name: string }[];
    const delhi = all.find((x) => x.name === 'Delhi one') as { id: string }; const puneOne = all.find((x) => x.name === 'Pune one') as { id: string };
    expect((await call(server, 'GET', `/v1/leads/${delhi.id}`, { token: pune.token })).status).toBe(404); // outside the territory: looks absent
    expect((await call(server, 'POST', `/v1/leads/${delhi.id}/activities`, { token: pune.token, body: { kind: 'note', body: 'x' } })).status).toBe(404);
    expect((await call(server, 'POST', `/v1/leads/${puneOne.id}/activities`, { token: pune.token, body: { kind: 'note', body: 'Called' } })).status).toBe(201);
    // a lead handed to someone is theirs wherever it is; one they add themselves stays visible to them
    ok(await call(server, 'POST', `/v1/leads/${delhi.id}/assign`, { tenant: t, body: { ownerId: pune.id } }), 200);
    expect(await names(pune.token)).toContain('Delhi one');
    const own = await call(server, 'POST', '/v1/leads', { token: mumbai.token, body: { name: 'Mine in Goa', phone: '9820000009', city: 'Goa' } }); expect(own.status).toBe(201);
    expect(await names(mumbai.token)).toContain('Mine in Goa');
  });
});

describe('leads: details each business defines', () => {
  it('a business adds its own fields; typed-in leads must satisfy them, arriving enquiries are taken as they come and filed under the right field', async () => {
    const s = await kit.shop('Leads Fields Co'); const t = s.tenant;
    const defs = [{ key: 'class_wanted', label: 'Class wanted', type: 'select', options: ['Nursery', 'KG', 'Class 1'], required: true }, { key: 'monthly_budget', label: 'Monthly budget', type: 'number' }];
    await call(server, 'GET', '/v1/leads/settings', { tenant: t });
    ok(await call(server, 'PUT', '/v1/leads/settings', { tenant: t, body: { assignmentMode: 'manual', members: [], slaMinutes: 30, lostReasons: ['Other'], rules: [], customFields: defs } }), 200);
    expect(ok(await call(server, 'GET', '/v1/leads/settings', { tenant: t }), 200).customFields).toHaveLength(2);
    expect((await call(server, 'POST', '/v1/leads', { tenant: t, body: { name: 'A', phone: '9830000001' } })).status).toBe(422); // required field missing
    expect((await call(server, 'POST', '/v1/leads', { tenant: t, body: { name: 'A', phone: '9830000001', fields: { class_wanted: 'College' } } })).status).toBe(422); // not an option
    expect((await call(server, 'POST', '/v1/leads', { tenant: t, body: { name: 'A', phone: '9830000001', fields: { class_wanted: 'KG', monthly_budget: 'lots' } } })).status).toBe(422); // not a number
    const okLead = await lead(t, { name: 'A', phone: '9830000001', fields: { class_wanted: 'KG', monthly_budget: '5000' } });
    expect(okLead.fields).toEqual({ class_wanted: 'KG', monthly_budget: '5000' });
    expect((await call(server, 'PATCH', `/v1/leads/${okLead.id}`, { tenant: t, body: { fields: { monthly_budget: '6000' } } })).status).toBe(422); // edit must still satisfy the required one
    ok(await call(server, 'PATCH', `/v1/leads/${okLead.id}`, { tenant: t, body: { fields: { class_wanted: 'Nursery', monthly_budget: '6000' } } }), 200);
    // a website form that words it differently
    const c = await connector(t, { kind: 'website', name: 'School site' });
    expect((await call(server, 'POST', c.path, { body: { name: 'Parent', phone: '9830000002', 'Class wanted': 'KG', 'Monthly Budget': '4000', hobby: 'chess' } })).status).toBe(200);
    const got = ok(await call(server, 'GET', '/v1/leads?q=Parent', { tenant: t }), 200).items[0];
    expect(got.fields).toEqual({ class_wanted: 'KG', monthly_budget: '4000', hobby: 'chess' });
    expect((await call(server, 'PUT', '/v1/leads/settings', { tenant: t, body: { assignmentMode: 'manual', members: [], slaMinutes: 30, lostReasons: ['Other'], rules: [], customFields: [{ key: 'Bad Key', label: 'x', type: 'text' }] } })).status).toBe(422);
  });
});
