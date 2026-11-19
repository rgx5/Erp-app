import { generateKeyPairSync, sign } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonical } from '../../src/modules/identity/entitlements.service.js';
import { call, createTenant, PLATFORM_TOKEN, startServer, type TestServer } from '../support/harness.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }).toString();
let server: TestServer;
beforeAll(async () => { server = await startServer({ LICENCE_PUBLIC_KEY: PUB, MIN_CLIENT_VERSION: '1.4.0' }); });
afterAll(async () => { await server.close(); });

const platform = (method: string, path: string, body?: unknown) => call(server, method, path, { token: PLATFORM_TOKEN, ...(body !== undefined ? { body } : {}) });
const setEnt = (tenant: string, body: object) => platform('PUT', `/v1/platform/tenants/${tenant}/entitlements`, body);
const me = async (tenant: string) => (await call(server, 'GET', '/v1/auth/me', { tenant })).json.entitlements;
const status = async (tenant: string, method: string, path: string, body?: unknown) => (await call(server, method, path, { tenant, ...(body !== undefined ? { body } : {}) }));

describe('entitlements', () => {
  it('leaves a tenant with no licence unrestricted', async () => {
    const t = await createTenant(server, 'No Licence Co');
    expect(await me(t)).toMatchObject({ restricted: false, readOnly: false });
    expect((await status(t, 'GET', '/v1/payroll/people')).status).not.toBe(403);
    expect((await platform('GET', `/v1/platform/tenants/${t}/entitlements`)).json.entitlements).toBeNull();
  });

  it('refuses a module that is not licensed, and tells the app what is', async () => {
    const t = await createTenant(server, 'Sales Only Co');
    expect((await setEnt(t, { plan: 'Starter', modules: ['sales'] })).status).toBe(200);
    expect(await me(t)).toMatchObject({ restricted: true, plan: 'Starter', modules: ['sales'] });
    const refused = await status(t, 'GET', '/v1/payroll/runs');
    expect(refused.status).toBe(403); expect(refused.json.code).toBe('module_not_licensed');
    expect((await status(t, 'GET', '/v1/stock/balances')).json.code).toBe('module_not_licensed');
    expect((await status(t, 'GET', '/v1/accounting/trial-balance')).json.code).toBe('module_not_licensed');
    expect((await status(t, 'GET', '/v1/sales/invoices')).status).not.toBe(403); // licensed
    expect((await status(t, 'GET', '/v1/companies')).status).toBe(200); // core is always on
    // adding the module opens it at once, with no restart
    expect((await setEnt(t, { plan: 'Starter', modules: ['sales', 'accounting'] })).status).toBe(200);
    expect((await status(t, 'GET', '/v1/accounting/trial-balance')).json?.code).not.toBe('module_not_licensed');
  });

  it('rejects unknown modules and modules whose dependencies are missing', async () => {
    const t = await createTenant(server, 'Deps Co');
    expect((await setEnt(t, { modules: ['pos'] })).status).toBe(422);
    expect((await setEnt(t, { modules: ['payroll'] })).status).toBe(422);
    expect((await setEnt(t, { modules: ['bogus'] })).status).toBe(422);
    expect((await setEnt(t, { modules: ['pos', 'sales', 'inventory'] })).status).toBe(200);
  });

  it('makes a suspended tenant read-only but lets it read and sign out', async () => {
    const t = await createTenant(server, 'Suspended Co');
    expect((await setEnt(t, { modules: ['sales'], readOnly: true })).status).toBe(200);
    const write = await status(t, 'POST', '/v1/companies', { legalName: 'Nope Pvt Ltd', pan: 'ABCDE1234F' });
    expect(write.status).toBe(403); expect(write.json.code).toBe('tenant_read_only');
    expect((await status(t, 'GET', '/v1/companies')).status).toBe(200);
    expect(await me(t)).toMatchObject({ readOnly: true, readOnlyReason: 'suspended' });
    expect((await platform('PUT', `/v1/platform/tenants/${t}/entitlements`, { modules: ['sales'], readOnly: false })).status).toBe(200);
    expect((await status(t, 'POST', '/v1/companies', { legalName: 'Back Pvt Ltd', pan: 'ABCDE1234F' })).status).toBe(201);
  });

  it('allows a grace period after expiry, then goes read-only', async () => {
    const t = await createTenant(server, 'Expiry Co');
    const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
    expect((await setEnt(t, { modules: ['sales'], expiresAt: days(-3), graceDays: 7 })).status).toBe(200);
    expect((await me(t)).readOnly).toBe(false); // inside the grace period
    expect((await me(t)).daysLeft).toBeLessThanOrEqual(-2);
    expect((await setEnt(t, { modules: ['sales'], expiresAt: days(-3), graceDays: 1 })).status).toBe(200);
    expect(await me(t)).toMatchObject({ readOnly: true, readOnlyReason: 'expired' });
    expect((await status(t, 'POST', '/v1/companies', { legalName: 'Late Pvt Ltd', pan: 'ABCDE1234F' })).json.code).toBe('tenant_read_only');
  });

  it('caps how many users, companies and locations a licence allows', async () => {
    const t = await createTenant(server, 'Limits Co');
    expect((await setEnt(t, { modules: ['sales'], limits: { users: 1, companies: 1 } })).status).toBe(200);
    const roles = (await status(t, 'GET', '/v1/roles')).json.items as { id: string }[];
    const extra = await status(t, 'POST', '/v1/users', { email: 'second@limits.example.com', displayName: 'Second', password: 'a-long-password-123', roleIds: [roles[0]?.id] });
    expect(extra.status).toBe(409); expect(extra.json.code).toBe('limit_reached');
    expect((await status(t, 'POST', '/v1/companies', { legalName: 'First Pvt Ltd', pan: 'ABCDE1234F' })).status).toBe(201);
    const second = await status(t, 'POST', '/v1/companies', { legalName: 'Second Pvt Ltd', pan: 'BCDEF2345G' });
    expect(second.status).toBe(409); expect(second.json.code).toBe('limit_reached');
    expect((await setEnt(t, { modules: ['sales'], limits: { users: 5, companies: 2 } })).status).toBe(200);
    expect((await status(t, 'POST', '/v1/companies', { legalName: 'Second Pvt Ltd', pan: 'BCDEF2345G' })).status).toBe(201);
  });

  it('applies a signed licence, and refuses a forged, edited or wrong-tenant one', async () => {
    const t = await createTenant(server, 'Licence Co');
    const other = await createTenant(server, 'Other Licence Co');
    const licence = { licenceId: 'LIC-1', tenantId: t, plan: 'Hybrid', modules: ['sales', 'inventory'], limits: { users: 10 }, readOnly: false, expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), graceDays: 14, issuedAt: new Date().toISOString() };
    const signed = { licence, signature: sign(null, Buffer.from(canonical(licence)), privateKey).toString('base64') };
    const ok = await platform('POST', `/v1/platform/tenants/${t}/licence`, signed);
    expect(ok.status).toBe(200); expect(ok.json).toMatchObject({ plan: 'Hybrid', source: 'licence', licenceId: 'LIC-1' });
    expect(await me(t)).toMatchObject({ plan: 'Hybrid', modules: ['inventory', 'sales'] });

    const edited = { licence: { ...licence, modules: ['sales', 'inventory', 'payroll', 'accounting'] }, signature: signed.signature };
    expect((await platform('POST', `/v1/platform/tenants/${t}/licence`, edited)).json.code).toBe('licence_invalid');
    const { privateKey: wrong } = generateKeyPairSync('ed25519');
    const forged = { licence, signature: sign(null, Buffer.from(canonical(licence)), wrong).toString('base64') };
    expect((await platform('POST', `/v1/platform/tenants/${t}/licence`, forged)).json.code).toBe('licence_invalid');
    expect((await platform('POST', `/v1/platform/tenants/${other}/licence`, signed)).json.code).toBe('licence_wrong_tenant');
  });

  it('requires the platform token, and audits the change', async () => {
    const t = await createTenant(server, 'Audit Ent Co');
    expect((await call(server, 'PUT', `/v1/platform/tenants/${t}/entitlements`, { tenant: t, body: { modules: [] } })).status).toBeGreaterThanOrEqual(401);
    expect((await setEnt(t, { modules: ['sales'] })).status).toBe(200);
    const audit = await call(server, 'GET', '/v1/audit-events?limit=50', { tenant: t });
    expect((audit.json.items as { action: string }[]).some((e) => e.action === 'entitlements.set')).toBe(true);
  });

  it('tells clients the oldest version it serves', async () => {
    expect((await call(server, 'GET', '/v1/meta')).json.minClientVersion).toBe('1.4.0');
  });
});
