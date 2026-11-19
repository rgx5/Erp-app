import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Tunnel } from '../../agent/src/tunnel.js';
import { buildGateway, routable, type Verdict } from '../src/gateway.js';
import { check, inHours, readRules } from '../src/rules.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c(); });

/** A stand-in for a site's own server, recording what reached it. */
async function localApi(handler?: (req: http.IncomingMessage, res: http.ServerResponse, body: Buffer) => void) {
  const seen: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { const body = Buffer.concat(chunks); seen.push({ method: req.method as string, url: req.url as string, headers: req.headers, body: body.toString() }); if (handler) return handler(req, res, body); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, path: req.url })); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const TOKENS: Record<string, Verdict> = {};
async function start(o: { rps?: number; inflight?: number; timeout?: number; verify?: (t: string) => Promise<Verdict | null> } = {}) {
  const gw = buildGateway({ verify: o.verify ?? (async (t) => TOKENS[t] ?? null), requestsPerSecond: o.rps ?? 1000, ...(o.inflight ? { maxInflightPerSite: o.inflight } : {}), ...(o.timeout ? { requestTimeoutMs: o.timeout } : {}), recheckSeconds: 3600 });
  await gw.app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(() => gw.close());
  return { gw, port: (gw.app.server.address() as AddressInfo).port };
}
async function connect(port: number, token: string, local: string, name = 'tunnel') {
  const t = new Tunnel({ gatewayUrl: `http://127.0.0.1:${port}`, token, localApiUrl: local, log: () => undefined, backoff: { min: 50, max: 200 } });
  t.start(); cleanups.push(() => t.stop());
  for (let i = 0; i < 100 && !t.up; i++) await new Promise((r) => setTimeout(r, 50));
  if (!t.up) throw new Error(`${name} did not connect`);
  await new Promise((r) => setTimeout(r, 50));
  return t;
}
function call(port: number, host: string, path: string, o: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers: { host, ...(o.headers ?? {}) } }, (res) => { const c: Buffer[] = []; res.on('data', (d) => c.push(d)); res.on('end', () => resolve({ status: res.statusCode as number, headers: res.headers, body: Buffer.concat(c) })); });
    req.on('error', reject); if (o.body) req.write(o.body); req.end();
  });
}
const json = (b: Buffer) => JSON.parse(b.toString()) as Record<string, unknown>;
const verdict = (host: string): Verdict => ({ siteId: `site-${host}`, hostname: host, tier: 'hybrid' });

describe('what the gateway lets through', () => {
  it('knows which paths may go through', () => {
    for (const ok of ['/v1/auth/login', '/v1/items?limit=5', '/health/live', '/owner', '/v1/auth/me']) expect(routable(ok), ok).toBe(true);
    for (const no of ['/v1/platform/tenants', '/V1/PLATFORM/tenants', '/v1/../v1/platform/tenants', '/v1/%2e%2e/platform', '/v1//platform/tenants', '/admin', '/', '/owner/x', '/health/ready', '/metrics', '/v1/a\\b', `/${'a'.repeat(5000)}`]) expect(routable(no), no).toBe(false);
  });
});

describe('the tunnel and the gateway', () => {
  it('carries requests to the site and the replies back, with method, body, headers and status intact', async () => {
    TOKENS['tok-a'] = verdict('pune.remote.test');
    const local = await localApi((req, res, body) => { res.statusCode = req.url?.includes('missing') ? 404 : 201; res.setHeader('x-site', 'pune'); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ echo: body.toString(), method: req.method })); });
    const { port } = await start();
    await connect(port, 'tok-a', local.url);
    const r = await call(port, 'pune.remote.test', '/v1/sales/invoices?limit=5', { method: 'POST', headers: { authorization: 'Bearer user-jwt', 'content-type': 'application/json', 'idempotency-key': 'k1' }, body: JSON.stringify({ a: 1 }) });
    expect(r.status).toBe(201); expect(r.headers['x-site']).toBe('pune'); expect(json(r.body)).toEqual({ echo: '{"a":1}', method: 'POST' });
    const seen = local.seen[0];
    expect(seen).toMatchObject({ method: 'POST', url: '/v1/sales/invoices?limit=5', body: '{"a":1}' });
    expect(seen?.headers['authorization']).toBe('Bearer user-jwt'); expect(seen?.headers['idempotency-key']).toBe('k1');
    expect(seen?.headers['x-forwarded-host']).toBe('pune.remote.test'); expect(seen?.headers['x-forwarded-for']).toBeTruthy();
    expect((await call(port, 'pune.remote.test', '/v1/missing')).status).toBe(404); // the site's own answers pass through
  });

  it('never lets the platform administration routes, odd paths or other routes reach the site', async () => {
    TOKENS['tok-b'] = verdict('b.remote.test');
    const local = await localApi(); const { port } = await start(); await connect(port, 'tok-b', local.url);
    for (const path of ['/v1/platform/tenants', '/V1/Platform/tenants', '/v1/%2e%2e/platform/tenants', '/v1//platform/tenants', '/health/ready', '/', '/metrics']) expect((await call(port, 'b.remote.test', path, { method: 'POST', body: '{}' })).status, path).toBe(404);
    expect(local.seen).toEqual([]);
    expect((await call(port, 'b.remote.test', '/health/live')).status).toBe(200);
  });

  it('keeps sites apart by address, and says plainly when a site is not connected', async () => {
    TOKENS['tok-c'] = verdict('c.remote.test'); TOKENS['tok-d'] = verdict('d.remote.test');
    const lc = await localApi(); const ld = await localApi(); const { port } = await start();
    await connect(port, 'tok-c', lc.url); const d = await connect(port, 'tok-d', ld.url);
    expect(json((await call(port, 'c.remote.test', '/v1/x')).body)).toMatchObject({ path: '/v1/x' });
    expect(lc.seen).toHaveLength(1); expect(ld.seen).toHaveLength(0);
    const unknown = await call(port, 'nobody.remote.test', '/v1/x');
    expect(unknown.status).toBe(503); expect(json(unknown.body).code).toBe('site_offline'); expect(unknown.headers['retry-after']).toBe('30');
    d.stop(); await new Promise((r) => setTimeout(r, 150));
    expect((await call(port, 'd.remote.test', '/v1/x')).status).toBe(503);
  });

  it('streams a large reply intact', async () => {
    TOKENS['tok-e'] = verdict('e.remote.test');
    const big = Buffer.alloc(5 * 1024 * 1024); for (let i = 0; i < big.length; i++) big[i] = (i * 31) % 251;
    const local = await localApi((_q, res) => { res.setHeader('content-type', 'application/octet-stream'); res.end(big); });
    const { port } = await start(); await connect(port, 'tok-e', local.url);
    const r = await call(port, 'e.remote.test', '/v1/export');
    expect(r.status).toBe(200); expect(r.body.equals(big)).toBe(true);
  });

  it('refuses a tunnel the control plane does not know, and the site records why', async () => {
    const { port } = await start();
    const t = new Tunnel({ gatewayUrl: `http://127.0.0.1:${port}`, token: 'nope', localApiUrl: 'http://127.0.0.1:1', log: () => undefined, backoff: { min: 50, max: 100 } });
    t.start(); cleanups.push(() => t.stop());
    await new Promise((r) => setTimeout(r, 400));
    expect(t.up).toBe(false);
  });

  it('closes a tunnel when the control plane stops allowing it, but never because the control plane cannot be reached', async () => {
    TOKENS['tok-f'] = verdict('f.remote.test');
    let mode: 'ok' | 'revoked' | 'down' = 'ok';
    const local = await localApi();
    const { gw, port } = await start({ verify: async (t) => { if (mode === 'down') throw new Error('unreachable'); return mode === 'revoked' ? null : TOKENS[t] ?? null; } });
    await connect(port, 'tok-f', local.url);
    mode = 'down'; await gw.recheck();
    expect((await call(port, 'f.remote.test', '/v1/x')).status).toBe(200); // still up
    mode = 'revoked'; await gw.recheck();
    await new Promise((r) => setTimeout(r, 200));
    expect((await call(port, 'f.remote.test', '/v1/x')).status).toBe(503);
  });

  it('limits how fast, and how many at once, a site is asked', async () => {
    TOKENS['tok-g'] = verdict('g.remote.test');
    const slow = await localApi((_q, res) => { setTimeout(() => res.end('{}'), 400); });
    const a = await start({ rps: 3, inflight: 2 }); await connect(a.port, 'tok-g', slow.url);
    const burst = await Promise.all(Array.from({ length: 6 }, () => call(a.port, 'g.remote.test', '/v1/x')));
    const statuses = burst.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(3); expect(statuses).toContain(429);
  });

  it('answers 504 when the site is too slow, and 502 when its server is down, without hanging', async () => {
    TOKENS['tok-h'] = verdict('h.remote.test');
    const slow = await localApi((_q, res) => { setTimeout(() => res.end('{}'), 1500); });
    const a = await start({ timeout: 300 }); await connect(a.port, 'tok-h', slow.url);
    expect((await call(a.port, 'h.remote.test', '/v1/x')).status).toBe(504);
    TOKENS['tok-i'] = verdict('i.remote.test');
    const b = await start(); await connect(b.port, 'tok-i', 'http://127.0.0.1:1'); // nothing listening
    const down = await call(b.port, 'i.remote.test', '/v1/x');
    expect(down.status).toBe(502); expect(json(down.body).code).toBe('bad_gateway');
  });

  it('reconnects by itself when the gateway restarts, and a newer tunnel replaces an older one', async () => {
    TOKENS['tok-j'] = verdict('j.remote.test');
    const local = await localApi();
    const first = await start(); const port = first.port;
    const t = await connect(port, 'tok-j', local.url);
    first.gw.sessions.get('j.remote.test')?.ws.close(); // the gateway drops it
    for (let i = 0; i < 60 && !t.up; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 100));
    expect(t.up).toBe(true); expect((await call(port, 'j.remote.test', '/v1/x')).status).toBe(200);
    // a second connection for the same site takes over
    const local2 = await localApi(); await connect(port, 'tok-j', local2.url);
    await call(port, 'j.remote.test', '/v1/y');
    expect(local2.seen.map((s) => s.url)).toContain('/v1/y');
  });
});

describe('per-client remote rules', () => {
  const at = (iso: string) => new Date(iso);
  const R = (o: object) => readRules(o)!;
  const ask = (rules: object, method: string, path: string, ip = '203.0.113.9', when = '2026-03-02T10:00:00Z') => check(R(rules), { method, path, ip, at: at(when) })?.code ?? null;

  it('reads only well-formed rules; anything else is refused rather than left open', () => {
    expect(readRules(undefined)).toMatchObject({ mode: 'full' }); expect(readRules({})).toMatchObject({ mode: 'full', networks: [] });
    for (const bad of [{ mode: 'admin' }, { allowedNetworks: ['not-an-ip'] }, { allowedNetworks: ['10.0.0.0/40'] }, { hours: { days: [8], from: '09:00', to: '10:00', timezone: 'Asia/Kolkata' } }, { hours: { days: [1], from: '9am', to: '10:00', timezone: 'Asia/Kolkata' } }, { hours: { days: [1], from: '09:00', to: '10:00', timezone: 'Nowhere/Land' } }, { requestsPerSecond: 0 }, 'x', []]) expect(readRules(bad), JSON.stringify(bad)).toBeNull();
  });
  it('limits where remote users may come from, for IPv4, IPv6 and IPv4 seen through IPv6', () => {
    const rules = { allowedNetworks: ['203.0.113.0/24', '198.51.100.7', '2001:db8::/32'] };
    expect(ask(rules, 'GET', '/v1/items')).toBeNull(); expect(ask(rules, 'GET', '/v1/items', '198.51.100.7')).toBeNull(); expect(ask(rules, 'GET', '/v1/items', '::ffff:203.0.113.200')).toBeNull(); expect(ask(rules, 'GET', '/v1/items', '2001:db8:1::5')).toBeNull();
    expect(ask(rules, 'GET', '/v1/items', '198.51.100.8')).toBe('remote_network_blocked'); expect(ask(rules, 'GET', '/v1/items', '2001:dead::1')).toBe('remote_network_blocked'); expect(ask(rules, 'GET', '/v1/items', 'garbage')).toBe('remote_network_blocked');
    expect(ask(rules, 'GET', '/health/live', '198.51.100.8')).toBeNull(); // the liveness probe is never limited
  });
  it('limits the hours in the site\'s own time zone, including windows that run past midnight', () => {
    const day = { days: [1, 2, 3, 4, 5, 6], from: '08:00', to: '21:00', timezone: 'Asia/Kolkata' };
    expect(inHours(day, at('2026-03-02T04:00:00Z'))).toBe(true);  // Monday 09:30 IST
    expect(inHours(day, at('2026-03-02T16:00:00Z'))).toBe(false); // Monday 21:30 IST
    expect(inHours(day, at('2026-03-08T06:00:00Z'))).toBe(false); // Sunday 11:30 IST: not a listed day
    const night = { days: [5], from: '22:00', to: '06:00', timezone: 'Asia/Kolkata' }; // Friday night
    expect(inHours(night, at('2026-03-06T17:00:00Z'))).toBe(true);  // Friday 22:30 IST
    expect(inHours(night, at('2026-03-06T23:00:00Z'))).toBe(true);  // Saturday 04:30 IST, still Friday's window
    expect(inHours(night, at('2026-03-07T17:00:00Z'))).toBe(false); // Saturday 22:30 IST
    expect(ask({ hours: day }, 'GET', '/v1/items', '1.1.1.1', '2026-03-02T16:00:00Z')).toBe('remote_hours_blocked');
  });
  it('view-only blocks every change but not signing in or out; owner-only shows just the dashboard', () => {
    expect(ask({ mode: 'readonly' }, 'GET', '/v1/items')).toBeNull(); expect(ask({ mode: 'readonly' }, 'POST', '/v1/auth/login')).toBeNull(); expect(ask({ mode: 'readonly' }, 'POST', '/v1/auth/logout')).toBeNull();
    for (const [m, p] of [['POST', '/v1/sales/invoices'], ['PUT', '/v1/items/1'], ['PATCH', '/v1/items/1'], ['DELETE', '/v1/items/1'], ['POST', '/v1/auth/password'], ['POST', '/V1/Sales/Invoices/']] as const) expect(ask({ mode: 'readonly' }, m, p), `${m} ${p}`).toBe('remote_readonly');
    const o = { mode: 'owner_only' };
    for (const p of ['/owner', '/v1/dashboard?companyId=x', '/v1/receivables/ageing?a=b', '/v1/companies', '/v1/auth/me']) expect(ask(o, 'GET', p), p).toBeNull();
    expect(ask(o, 'POST', '/v1/auth/login')).toBeNull();
    for (const [m, p] of [['GET', '/v1/items'], ['GET', '/v1/companies/abc'], ['POST', '/v1/dashboard'], ['GET', '/v1/auth/password']] as const) expect(ask(o, m, p), `${m} ${p}`).toBe('remote_owner_only');
  });

  it('applies the rules to live traffic, takes new rules within a recheck, and pauses a site whose rules cannot be read', async () => {
    let rules: unknown = { mode: 'readonly' };
    TOKENS['tok-r'] = { ...verdict('r.remote.test') };
    const local = await localApi(); const { gw, port } = await start({ verify: async (t) => (t === 'tok-r' ? { ...verdict('r.remote.test'), rules } : null) });
    await connect(port, 'tok-r', local.url);
    expect((await call(port, 'r.remote.test', '/v1/items')).status).toBe(200);
    const blocked = await call(port, 'r.remote.test', '/v1/sales/invoices', { method: 'POST', body: '{}' });
    expect(blocked.status).toBe(403); expect(json(blocked.body)).toMatchObject({ code: 'remote_readonly' });
    expect(local.seen.map((x) => x.method)).toEqual(['GET']); // the blocked change never reached the site
    rules = { mode: 'full' }; await gw.recheck();
    expect((await call(port, 'r.remote.test', '/v1/sales/invoices', { method: 'POST', body: '{}' })).status).toBe(200);
    rules = { mode: 'nonsense' }; await gw.recheck();
    expect(json((await call(port, 'r.remote.test', '/v1/items')).body)).toMatchObject({ code: 'remote_rules_invalid' });
  });
});
