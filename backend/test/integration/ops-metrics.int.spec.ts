import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createTenantWithOwner, PLATFORM_TOKEN, startServer, type TestServer } from '../support/harness.js';

let server: TestServer;
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server.close(); });

describe('operations endpoints', () => {
  it('serves metrics only to the platform token, with requests, pool and outbox figures', async () => {
    const t = await createTenantWithOwner(server, 'Metrics Co');
    await call(server, 'GET', '/v1/auth/me', { token: t.accessToken });
    expect((await call(server, 'GET', '/metrics')).status).toBe(403);
    const r = await call(server, 'GET', '/metrics', { token: PLATFORM_TOKEN });
    expect(r.status).toBe(200);
    const text = r.text;
    expect(text).toContain('erp_http_requests_total{method="GET",route="/v1/auth/me",status="2xx"}');
    expect(text).toContain('erp_http_request_seconds_bucket');
    expect(text).toContain('erp_db_pool_connections{state="total"}');
    expect(text).toMatch(/erp_outbox_pending \d+/);
    expect(text).toMatch(/erp_database_size_bytes \d+/);
  });

  it('reports row counts for one client, and only to the platform token', async () => {
    const t = await createTenantWithOwner(server, 'Usage Co');
    await call(server, 'POST', '/v1/parties', { token: t.accessToken, body: { code: 'U1', legalName: 'U One', isCustomer: true, gstTreatment: 'consumer' } });
    const id = t.id;
    expect((await call(server, 'GET', `/v1/platform/tenants/${id}/usage`, { token: t.accessToken })).status).toBe(403);
    const u = await call(server, 'GET', `/v1/platform/tenants/${id}/usage`, { token: PLATFORM_TOKEN });
    expect(u.status).toBe(200);
    const body = u.json as { tables: { table: string; rows: number }[]; totalRows: number };
    expect(body.tables.find((x) => x.table === 'parties')?.rows).toBe(1);
    expect(body.totalRows).toBeGreaterThan(0);
  });
});
