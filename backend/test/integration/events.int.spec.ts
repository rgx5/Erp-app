import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTenantWithOwner, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer;
const supers = superPool();
beforeAll(async () => { server = await startServer({ DASHBOARD_CACHE_TTL_MS: '30000' }); });
afterAll(async () => { await server.close(); await supers.end(); });

/** Reads the stream until `want` returns true for a note, or gives up. */
async function listen(token: string, trigger: () => Promise<unknown>, want: (note: { areas: string[] }) => boolean): Promise<boolean> {
  const ctl = new AbortController();
  const res = await fetch(`${server.base}/v1/events`, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal: ctl.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = '';
  const deadline = Date.now() + 5000; let fired = false;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value);
      if (!fired && buf.includes('"hello":true')) { fired = true; await trigger(); }
      for (const m of buf.matchAll(/data: (\{.*\})/g)) { const note = JSON.parse(m[1] as string) as { areas: string[] }; if (note.areas.length && want(note)) return true; }
    }
    return false;
  } finally { ctl.abort(); }
}

describe('change notes and the dashboard cache', () => {
  it('tells an open screen which area changed, only for its own client, and carries no data', async () => {
    const a = await createTenantWithOwner(server, 'Events A');
    const b = await createTenantWithOwner(server, 'Events B');
    const seen = await listen(a.accessToken, async () => {
      await call(server, 'POST', '/v1/parties', { token: b.accessToken, body: { code: 'B1', legalName: 'Other client', isCustomer: true, gstTreatment: 'consumer' } }); // not ours
      await call(server, 'POST', '/v1/parties', { token: a.accessToken, body: { code: 'A1', legalName: 'Secret Name Ltd', isCustomer: true, gstTreatment: 'consumer' } });
    }, (n) => n.areas.includes('parties'));
    expect(seen).toBe(true);
    expect((await fetch(`${server.base}/v1/events`)).status).toBe(401);
  });

  it('keeps the dashboard answer for a moment and drops it as soon as that client changes something', async () => {
    const kit = shopKit(server, supers);
    const s = await kit.shop('Dash Cache Co');
    const get = async () => (await call(server, 'GET', `/v1/dashboard?asOf=2025-12-01&companyId=${s.companyId}`, { tenant: s.tenant })).json;
    const before = await get();
    // a change made behind the API's back is not seen while the answer is kept
    await supers.query("UPDATE erp.companies SET legal_name = legal_name WHERE id = $1", [s.companyId]);
    expect(await get()).toEqual(before);
    ok(await call(server, 'POST', '/v1/journal-entries', { tenant: s.tenant, body: { companyId: s.companyId, postingDate: '2025-12-01', description: 'cash in', lines: [{ accountId: s.acc['1120'], debit: '777.00' }, { accountId: s.acc['3100'], credit: '777.00' }] } }));
    // the answer after the change matches what a server with no cache says
    const fresh = await startServer({ DASHBOARD_CACHE_TTL_MS: '0' });
    try {
      const truth = (await call(fresh, 'GET', `/v1/dashboard?asOf=2025-12-01&companyId=${s.companyId}`, { tenant: s.tenant })).json;
      expect(await get()).toEqual(truth);
    } finally { await fresh.close(); }
  });
});
