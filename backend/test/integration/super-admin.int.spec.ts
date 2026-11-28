import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER_PASSWORD, PLATFORM_TOKEN, call, createTenantWithOwner, startServer, type TenantHandle, type TestServer } from '../support/harness.js';

let server: TestServer;
let t: TenantHandle;
const STRONG = 'a long passphrase for support 42';
beforeAll(async () => { server = await startServer(); t = await createTenantWithOwner(server, 'Super Admin Co'); });
afterAll(async () => { await server.close(); });
const login = async (email: string, password: string) => (await call(server, 'POST', '/v1/auth/login', { body: { tenant: t.slug, email, password } })).json as { accessToken: string };

describe('super admin and company admin', () => {
  it('our team gets a Super admin login that the company owner cannot see, change or grant, and only it can change licensing', async () => {
    const sa = await call(server, 'POST', `/v1/platform/tenants/${t.id}/super-admin`, { token: PLATFORM_TOKEN, body: { email: 'support@onesyncerp.example.com', displayName: 'OneSync Support', password: STRONG } });
    expect(sa.status, JSON.stringify(sa.json)).toBe(201);
    const superToken = (await login('support@onesyncerp.example.com', STRONG)).accessToken;
    const ownerToken = t.accessToken;

    // the company's owner (company admin) does not see the support account or its role
    const ownerUsers = (await call(server, 'GET', '/v1/users', { token: ownerToken })).json.items as Array<{ id: string; email: string }>;
    expect(ownerUsers.map((u) => u.email)).not.toContain('support@onesyncerp.example.com');
    expect((await call(server, 'GET', `/v1/users/${sa.json.id}`, { token: ownerToken })).status).toBe(404);
    const ownerRoles = (await call(server, 'GET', '/v1/roles', { token: ownerToken })).json.items as Array<{ name: string }>;
    expect(ownerRoles.map((r) => r.name)).not.toContain('Super admin');
    // ... and cannot disable it or hand out its powers
    expect((await call(server, 'PATCH', `/v1/users/${sa.json.id}`, { token: ownerToken, headers: { 'if-match': '"1"' }, body: { status: 'disabled' } })).status).toBe(404);
    const platformRole = await call(server, 'POST', '/v1/roles', { token: ownerToken, body: { name: 'Sneaky', permissions: ['platform:licensing'] } });
    expect(platformRole.status).toBe(403);

    // the super admin sees everything
    const superUsers = (await call(server, 'GET', '/v1/users', { token: superToken })).json.items as Array<{ email: string }>;
    expect(superUsers.map((u) => u.email)).toContain('support@onesyncerp.example.com');
    expect(superUsers.map((u) => u.email)).toContain(t.ownerEmail);

    // licensing: anyone who can see the organisation may read it, only the super admin may change it
    expect((await call(server, 'GET', '/v1/admin/licence', { token: ownerToken })).status).toBe(200);
    const change = { plan: 'starter', modules: ['accounting', 'sales'], limits: {}, readOnly: false, graceDays: 7 };
    expect((await call(server, 'PUT', '/v1/admin/licence', { token: ownerToken, body: change })).status).toBe(403);
    const set = await call(server, 'PUT', '/v1/admin/licence', { token: superToken, body: change });
    expect(set.status, JSON.stringify(set.json)).toBe(200);
    expect((await call(server, 'GET', '/v1/auth/me', { token: ownerToken })).json.entitlements.modules).toContain('sales');

    // the owner is still the only company owner: the support account does not count as one
    expect((await call(server, 'PATCH', `/v1/users/${(await call(server, 'GET', '/v1/auth/me', { token: ownerToken })).json.user.id}`, { token: superToken, headers: { 'if-match': '"1"' }, body: { status: 'disabled' } })).status).toBe(409);
    expect(OWNER_PASSWORD.length).toBeGreaterThan(0);
  });
});
