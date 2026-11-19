import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../control-plane/test/support.js';
import { Tunnel } from '../../agent/src/tunnel.js';
import { buildGateway, type Verdict } from '../src/gateway.js';

// The whole chain: a real control plane decides who may connect, a real gateway, the real tunnel client, and a stand-in for the site's server.
let cp: Awaited<ReturnType<typeof testApp>>; let cpUrl = '';
const GW_TOKEN = 'g'.repeat(40);
beforeAll(async () => { cp = await testApp({ GATEWAY_TOKEN: GW_TOKEN }); await cp.app.listen({ port: 0, host: '127.0.0.1' }); cpUrl = `http://127.0.0.1:${(cp.app.server.address() as AddressInfo).port}`; });
afterAll(async () => { await cp.close(); });

async function verify(token: string): Promise<Verdict | null> {
  const res = await fetch(`${cpUrl}/gateway/verify`, { method: 'POST', headers: { authorization: `Bearer ${GW_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  if (res.status === 403) return null;
  if (!res.ok) throw new Error(`control plane answered ${res.status}`);
  return (await res.json()) as Verdict;
}

describe('remote access, from the control plane to the site', () => {
  it('opens for a Hybrid site with an address, carries a request, and closes when remote access is switched off', async () => {
    const admin = await cp.staff('admin');
    const client = (await cp.call('POST', '/clients', admin.token, { name: 'Chain Co', tier: 'hybrid' })).json;
    const site = (await cp.call('POST', '/sites', admin.token, { clientId: client.id, code: 'CHAIN-1', name: 'Chain' })).json;
    await cp.call('PATCH', `/sites/${site.id}`, admin.token, { hostname: 'chain.remote.test' });
    const token = (await cp.call('POST', `/sites/${site.id}/agent-token`, admin.token)).json.token as string;

    const local = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ path: req.url })); });
    await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
    const gw = buildGateway({ verify, recheckSeconds: 3600 });
    await gw.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (gw.app.server.address() as AddressInfo).port;
    const tunnel = new Tunnel({ gatewayUrl: `http://127.0.0.1:${port}`, token, localApiUrl: `http://127.0.0.1:${(local.address() as AddressInfo).port}`, log: () => undefined, backoff: { min: 50, max: 200 } });
    tunnel.start();
    for (let i = 0; i < 100 && !tunnel.up; i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 100));
    const get = () => new Promise<number>((resolve, reject) => { http.get({ host: '127.0.0.1', port, path: '/v1/items', headers: { host: 'chain.remote.test' } }, (r) => { r.resume(); r.on('end', () => resolve(r.statusCode as number)); }).on('error', reject); });
    expect(await get()).toBe(200);

    await cp.call('PATCH', `/sites/${site.id}`, admin.token, { remoteAccess: false });
    await gw.recheck();
    await new Promise((r) => setTimeout(r, 300));
    expect(await get()).toBe(503); // switched off: the tunnel is closed

    tunnel.stop(); await gw.close(); local.closeAllConnections(); local.close();
  });
});
