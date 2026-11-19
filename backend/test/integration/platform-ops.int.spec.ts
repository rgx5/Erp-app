import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createRegistration, createTenant, PLATFORM_TOKEN, startServer, superPool, type TestServer } from '../support/harness.js';
import { ok, shopKit } from '../support/shop.js';

let server: TestServer; let kit: ReturnType<typeof shopKit>;
const supers = superPool();
beforeAll(async () => { server = await startServer(); kit = shopKit(server, supers); });
afterAll(async () => { await server.close(); await supers.end(); });
const platform = (method: string, path: string, body?: unknown) => call(server, method, path, { token: PLATFORM_TOKEN, ...(body !== undefined ? { body } : {}) });

describe('platform operations', () => {
  it('lists every tenant on the server with usage and licence, counts only', async () => {
    const s = await kit.shop('Ops Listed Co');
    ok(await platform('PUT', `/v1/platform/tenants/${s.tenant}/entitlements`, { plan: 'Hybrid', modules: ['sales', 'inventory'], limits: { users: 5 } }), 200);
    const other = await createTenant(server, 'Ops Other Co');
    const list = (await platform('GET', '/v1/platform/tenants')).json.items as { id: string; name: string; status: string; usage: Record<string, number | null>; licence: { plan: string | null; modules: string[]; restricted: boolean } }[];
    const mine = list.find((t) => t.id === s.tenant); const bare = list.find((t) => t.id === other);
    expect(mine).toMatchObject({ name: 'Ops Listed Co', status: 'active', licence: { restricted: true, plan: 'Hybrid', modules: ['inventory', 'sales'] } });
    expect(mine?.usage).toMatchObject({ users: 1, companies: 1 }); expect(Number(mine?.usage['events30d'])).toBeGreaterThan(0); expect(mine?.usage['lastActivityAt']).not.toBeNull();
    expect(bare).toMatchObject({ licence: { restricted: false }, usage: { companies: 0, documents30d: 0 } });
    expect(JSON.stringify(list)).not.toMatch(/password|email/i); // identities and secrets never leave
    expect((await call(server, 'GET', '/v1/platform/tenants', { tenant: s.tenant })).status).toBeGreaterThanOrEqual(401); // a tenant owner cannot
  });

  it('validates a tenant: a healthy shop passes, a missing invoice series and a broken licence are caught', async () => {
    const s = await kit.shop('Ops Valid Co');
    // today is in a later financial year than the shop kit's, so a year and a series for the current one are needed (without them the check fails: invoicing would too)
    const today = new Date(); const startYear = today.getUTCMonth() >= 3 ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
    const stale = (await platform('GET', `/v1/platform/tenants/${s.tenant}/validate`)).json.checks as { key: string; status: string }[];
    if (startYear > 2025) expect(stale.find((c) => c.key === 'invoice_series')?.status).toBe('fail');
    ok(await call(server, 'POST', '/v1/fiscal-years', { tenant: s.tenant, body: { companyId: s.companyId, startDate: `${startYear}-04-01` } }));
    ok(await call(server, 'POST', '/v1/number-series', { tenant: s.tenant, body: { gstRegistrationId: s.regId, documentType: 'tax_invoice', financialYear: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`, prefix: 'INV' } }));
    const good = (await platform('GET', `/v1/platform/tenants/${s.tenant}/validate`)).json;
    expect(good.ok).toBe(true);
    expect((good.checks as { key: string; status: string }[]).map((c) => [c.key, c.status])).toEqual(expect.arrayContaining([['owner_exists', 'pass'], ['ledger_balanced', 'pass'], ['entries_match_lines', 'pass'], ['invoice_series', 'pass'], ['tenant_active', 'pass']]));

    const t = await createTenant(server, 'Ops Broken Co');
    await createRegistration(server, t, '27', 'ABCDE1234F'); // a GST registration, but no invoice series
    const bad = (await platform('GET', `/v1/platform/tenants/${t}/validate`)).json;
    expect(bad.ok).toBe(false);
    const series = (bad.checks as { key: string; status: string; detail: string }[]).find((c) => c.key === 'invoice_series');
    expect(series).toMatchObject({ status: 'fail' }); expect(series?.detail).toMatch(/1 of 1 missing/);
    // a licence that expires soon is a warning; suspended is a failure
    await platform('PUT', `/v1/platform/tenants/${t}/entitlements`, { modules: ['sales'], expiresAt: new Date(Date.now() + 10 * 86_400_000).toISOString() });
    expect(((await platform('GET', `/v1/platform/tenants/${t}/validate`)).json.checks as { key: string; status: string }[]).find((c) => c.key === 'licence_expiry')?.status).toBe('warn');
    await platform('PUT', `/v1/platform/tenants/${t}/entitlements`, { modules: ['sales'], readOnly: true });
    expect(((await platform('GET', `/v1/platform/tenants/${t}/validate`)).json.checks as { key: string; status: string }[]).find((c) => c.key === 'licence_expiry')?.status).toBe('fail');
    expect((await platform('GET', `/v1/platform/tenants/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/validate`)).status).toBe(404);
  });

  it('suspends a tenant so nobody can use it, reactivates it, and audits both', async () => {
    const s = await kit.shop('Ops Suspend Co');
    expect((await call(server, 'GET', '/v1/auth/me', { tenant: s.tenant })).status).toBe(200);
    expect((await platform('POST', `/v1/platform/tenants/${s.tenant}/status`, { status: 'suspended', reason: 'Unpaid invoice' })).json).toMatchObject({ status: 'suspended' });
    expect((await call(server, 'GET', '/v1/auth/me', { tenant: s.tenant })).status).toBe(401);
    expect((await platform('GET', `/v1/platform/tenants/${s.tenant}/validate`)).json.checks[0]).toMatchObject({ key: 'tenant_active', status: 'warn' });
    expect((await platform('POST', `/v1/platform/tenants/${s.tenant}/status`, { status: 'active', reason: 'Paid' })).json).toMatchObject({ status: 'active' });
    expect((await call(server, 'GET', '/v1/auth/me', { tenant: s.tenant })).status).toBe(200);
    const audit = await supers.query<{ action: string }>("SELECT action FROM erp.audit_log WHERE tenant_id = $1 AND action IN ('tenant.suspended', 'tenant.reactivated') ORDER BY id", [s.tenant]);
    expect(audit.rows.map((r) => r.action)).toEqual(['tenant.suspended', 'tenant.reactivated']);
    expect((await platform('POST', `/v1/platform/tenants/${s.tenant}/status`, { status: 'suspended', reason: 'x' })).status).toBe(422);
  });
});
