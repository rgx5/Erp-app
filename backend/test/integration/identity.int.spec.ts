import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, totpCode } from '../../src/modules/identity/totp.js';
import { OWNER_PASSWORD, appPool, call, createTenantWithOwner, startServer, superPool, uniqueSlug, type TenantHandle, type TestServer } from '../support/harness.js';

let server: TestServer;
let t: TenantHandle;
const STRONG = 'another long passphrase 42';

const login = (tenant: string, email: string, password: string, mfaCode?: string) =>
  call(server, 'POST', '/v1/auth/login', { body: { tenant, email, password, ...(mfaCode ? { mfaCode } : {}) } });
const as = (token: string) => ({ token });

async function newUser(token: string, email: string, roleIds: string[] = [], password = STRONG) {
  const res = await call(server, 'POST', '/v1/users', { ...as(token), body: { email, displayName: email.split('@')[0], password, roleIds } });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json as { id: string; version: number };
}
async function newRole(token: string, name: string, permissions: string[]) {
  const res = await call(server, 'POST', '/v1/roles', { ...as(token), body: { name, permissions } });
  expect(res.status, JSON.stringify(res.json)).toBe(201);
  return res.json as { id: string; version: number };
}
async function signIn(email: string, password = STRONG) {
  const res = await login(t.slug, email, password);
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json as { accessToken: string; refreshToken: string };
}
/** A TOTP code for the current step that is later than `after` (codes are single-use). */
const codeFor = (secret: string, offset = 0) => totpCode(secret, Math.floor(Date.now() / 30_000) + offset);

beforeAll(async () => {
  server = await startServer({ LOGIN_MAX_FAILURES: '3', LOGIN_LOCKOUT_SECONDS: '60', SELF_SIGNUP_ENABLED: 'false' });
  t = await createTenantWithOwner(server, 'Identity Co');
});
afterAll(async () => { await server.close(); });

describe('sign-in', () => {
  it('signs the owner in and describes them', async () => {
    const res = await login(t.slug, t.ownerEmail, OWNER_PASSWORD);
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ tokenType: 'Bearer', expiresIn: 900, user: { email: t.ownerEmail, mfaEnabled: false } });
    expect(JSON.stringify(res.json)).not.toMatch(/passwordHash|mfaSecret|failedLogin/);
    const me = await call(server, 'GET', '/v1/auth/me', as(res.json.accessToken));
    expect(me.json).toMatchObject({ kind: 'user', permissions: ['*'] });
  });
  it('answers identically for an unknown tenant, an unknown user and a wrong password', async () => {
    const results = await Promise.all([
      login('no-such-tenant', t.ownerEmail, 'whatever whatever'),
      login(t.slug, 'nobody@example.com', 'whatever whatever'),
      login(t.slug, t.ownerEmail, 'wrong wrong wrong wrong'),
    ]);
    for (const r of results) expect(r.status).toBe(401);
    expect(new Set(results.map((r) => JSON.stringify({ ...r.json, requestId: undefined, instance: undefined }))).size).toBe(1);
    expect(results[0]?.json.code).toBe('invalid_credentials');
  });
  it('locks an account after repeated failures, even for the right password, then recovers', async () => {
    const email = 'locky@example.com';
    await newUser(t.accessToken, email);
    for (let i = 0; i < 3; i++) expect((await login(t.slug, email, 'wrong wrong wrong wrong')).status).toBe(401);
    expect((await login(t.slug, email, STRONG)).status).toBe(401); // locked: indistinguishable from a wrong password
    const admin = superPool();
    await admin.query("UPDATE erp.users SET locked_until = now() - interval '1 second' WHERE email = $1", [email]);
    await admin.end();
    expect((await login(t.slug, email, STRONG)).status).toBe(200);
  });
  it('does not let one tenant\'s user sign in to another tenant', async () => {
    const other = await createTenantWithOwner(server, 'Other Co');
    expect((await login(other.slug, t.ownerEmail, OWNER_PASSWORD)).status).toBe(401);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the whole family when a spent token is replayed', async () => {
    const first = await signIn(t.ownerEmail, OWNER_PASSWORD);
    const second = await call(server, 'POST', '/v1/auth/refresh', { body: { refreshToken: first.refreshToken } });
    expect(second.status).toBe(200);
    expect(second.json.refreshToken).not.toBe(first.refreshToken);
    expect((await call(server, 'GET', '/v1/auth/me', as(second.json.accessToken))).status).toBe(200);
    // Replaying the spent token is treated as theft: the family dies, including the newest token.
    expect((await call(server, 'POST', '/v1/auth/refresh', { body: { refreshToken: first.refreshToken } })).status).toBe(401);
    expect((await call(server, 'POST', '/v1/auth/refresh', { body: { refreshToken: second.json.refreshToken } })).status).toBe(401);
    expect((await call(server, 'GET', '/v1/auth/me', as(second.json.accessToken))).status).toBe(401);
  });
  it('two simultaneous refreshes with one token cannot both succeed', async () => {
    const s = await signIn(t.ownerEmail, OWNER_PASSWORD);
    const results = await Promise.all([1, 2].map(() => call(server, 'POST', '/v1/auth/refresh', { body: { refreshToken: s.refreshToken } })));
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
  });
  it('rejects malformed, foreign-tenant and unknown refresh tokens', async () => {
    for (const refreshToken of ['garbage-garbage-garbage-garbage', 'rt_00000000000000000000000000000000_abcdefghijklmnopqrstuvwxyz', `rt_${t.id.replaceAll('-', '')}_${'a'.repeat(43)}`]) {
      expect((await call(server, 'POST', '/v1/auth/refresh', { body: { refreshToken } })).status).toBe(401);
    }
  });
  it('logout ends the session immediately', async () => {
    const s = await signIn(t.ownerEmail, OWNER_PASSWORD);
    expect((await call(server, 'POST', '/v1/auth/logout', as(s.accessToken))).status).toBe(204);
    expect((await call(server, 'GET', '/v1/auth/me', as(s.accessToken))).status).toBe(401);
    expect((await call(server, 'POST', '/v1/auth/refresh', { body: { refreshToken: s.refreshToken } })).status).toBe(401);
  });
  it('changing the password signs out the other devices but not this one', async () => {
    const email = 'pw@example.com';
    await newUser(t.accessToken, email);
    const phone = await signIn(email);
    const laptop = await signIn(email);
    const next = 'brand new passphrase 77';
    expect((await call(server, 'POST', '/v1/auth/password', { ...as(laptop.accessToken), body: { currentPassword: 'nope nope nope nope', newPassword: next } })).status).toBe(403);
    expect((await call(server, 'POST', '/v1/auth/password', { ...as(laptop.accessToken), body: { currentPassword: STRONG, newPassword: next } })).status).toBe(204);
    expect((await call(server, 'GET', '/v1/auth/me', as(phone.accessToken))).status).toBe(401);
    expect((await call(server, 'GET', '/v1/auth/me', as(laptop.accessToken))).status).toBe(200);
    expect((await login(t.slug, email, STRONG)).status).toBe(401);
    expect((await login(t.slug, email, next)).status).toBe(200);
  });
  it('a disabled user is cut off at once', async () => {
    const email = 'gone@example.com';
    const user = await newUser(t.accessToken, email);
    const s = await signIn(email);
    const res = await call(server, 'PATCH', `/v1/users/${user.id}`, { ...as(t.accessToken), headers: { 'if-match': String(user.version) }, body: { status: 'disabled' } });
    expect(res.status).toBe(200);
    expect((await call(server, 'GET', '/v1/auth/me', as(s.accessToken))).status).toBe(401);
    expect((await login(t.slug, email, STRONG)).status).toBe(401);
  });
});

describe('multi-factor authentication', () => {
  it('enrols, enforces, rejects code replay, honours single-use recovery codes, and can be disabled', async () => {
    const email = 'mfa@example.com';
    await newUser(t.accessToken, email);
    const s = await signIn(email);
    const enrol = await call(server, 'POST', '/v1/auth/mfa/enroll', as(s.accessToken));
    expect(enrol.status).toBe(201);
    expect(enrol.json.otpauthUri).toContain('otpauth://totp/');
    const secret = enrol.json.secret as string;
    expect(base32Decode(secret).length).toBe(20);
    // Not enforced until activated.
    expect((await login(t.slug, email, STRONG)).status).toBe(200);
    expect((await call(server, 'POST', '/v1/auth/mfa/activate', { ...as(s.accessToken), body: { code: '000000' } })).status).toBe(422);
    const activation = await call(server, 'POST', '/v1/auth/mfa/activate', { ...as(s.accessToken), body: { code: codeFor(secret) } });
    expect(activation.status).toBe(200);
    const recovery = activation.json.recoveryCodes as string[];
    expect(recovery).toHaveLength(10);

    const needsCode = await login(t.slug, email, STRONG);
    expect(needsCode.status).toBe(401);
    expect(needsCode.json.code).toBe('mfa_required');
    expect((await login(t.slug, email, STRONG, '123456')).status).toBe(401);
    // The activation code's step is spent; the next step's code works once.
    expect((await login(t.slug, email, STRONG, codeFor(secret))).status).toBe(401);
    const good = codeFor(secret, 1);
    expect((await login(t.slug, email, STRONG, good)).status).toBe(200);
    expect((await login(t.slug, email, STRONG, good)).status).toBe(401);

    const code = recovery[0] as string;
    expect((await login(t.slug, email, STRONG, code)).status).toBe(200);
    expect((await login(t.slug, email, STRONG, code)).status).toBe(401);

    const me = await signIn2(email, recovery[1] as string);
    const off = await call(server, 'POST', '/v1/auth/mfa/disable', { ...as(me), body: { password: STRONG, code: recovery[2] } });
    expect(off.status).toBe(204);
    expect((await login(t.slug, email, STRONG)).status).toBe(200);
    // The stored secret is encrypted at rest.
    const raw = superPool();
    const { rows } = await raw.query('SELECT mfa_secret_enc FROM erp.users WHERE email = $1', [email]);
    await raw.end();
    expect(rows[0].mfa_secret_enc).toBeNull();
  });
  it('stores the TOTP seed encrypted, never in clear', async () => {
    const email = 'mfa2@example.com';
    await newUser(t.accessToken, email);
    const s = await signIn(email);
    const secret = (await call(server, 'POST', '/v1/auth/mfa/enroll', as(s.accessToken))).json.secret as string;
    const raw = superPool();
    const { rows } = await raw.query('SELECT mfa_secret_enc FROM erp.users WHERE email = $1', [email]);
    await raw.end();
    expect(rows[0].mfa_secret_enc).toMatch(/^v1\./);
    expect(rows[0].mfa_secret_enc).not.toContain(secret);
  });
});

async function signIn2(email: string, recoveryCode: string): Promise<string> {
  const res = await login(t.slug, email, STRONG, recoveryCode);
  expect(res.status).toBe(200);
  return res.json.accessToken as string;
}

describe('authorization', () => {
  it('denies a signed-in user what their roles do not grant, and grants what they do', async () => {
    const reader = await newRole(t.accessToken, 'Org reader', ['organization:read']);
    await newUser(t.accessToken, 'reader@example.com', [reader.id]);
    const s = await signIn('reader@example.com');
    expect((await call(server, 'GET', '/v1/companies', as(s.accessToken))).status).toBe(200);
    expect((await call(server, 'POST', '/v1/companies', { ...as(s.accessToken), body: { legalName: 'X' } })).status).toBe(403);
    expect((await call(server, 'GET', '/v1/users', as(s.accessToken))).status).toBe(403);
  });
  it('applies a role change on the very next request', async () => {
    const role = await newRole(t.accessToken, 'Temp', ['organization:read']);
    await newUser(t.accessToken, 'temp@example.com', [role.id]);
    const s = await signIn('temp@example.com');
    expect((await call(server, 'GET', '/v1/companies', as(s.accessToken))).status).toBe(200);
    const patched = await call(server, 'PATCH', `/v1/roles/${role.id}`, { ...as(t.accessToken), headers: { 'if-match': String(role.version) }, body: { permissions: [] } });
    expect(patched.status).toBe(200);
    expect((await call(server, 'GET', '/v1/companies', as(s.accessToken))).status).toBe(403);
  });
  it('cannot be used to escalate: nobody grants permissions they do not hold', async () => {
    const delegate = await newRole(t.accessToken, 'User admin', ['users:write', 'users:read', 'roles:write', 'roles:read']);
    await newUser(t.accessToken, 'delegate@example.com', [delegate.id]);
    const s = await signIn('delegate@example.com');
    const owner = (await call(server, 'GET', '/v1/roles', as(s.accessToken))).json.items.find((r: { isSystem: boolean }) => r.isSystem);
    const grantOwner = await call(server, 'POST', '/v1/users', { ...as(s.accessToken), body: { email: 'sneak@example.com', displayName: 'S', password: STRONG, roleIds: [owner.id] } });
    expect(grantOwner.status).toBe(403);
    expect(grantOwner.json.code).toBe('privilege_escalation');
    const bigRole = await call(server, 'POST', '/v1/roles', { ...as(s.accessToken), body: { name: 'Big', permissions: ['organization:write'] } });
    expect(bigRole.status).toBe(403);
    const key = await call(server, 'POST', '/v1/api-keys', { ...as(s.accessToken), body: { name: 'k', permissions: ['users:write'] } });
    expect(key.status).toBe(403); // api_keys:manage is not held either
  });
  it('protects the built-in Owner role and the last owner', async () => {
    const roles = (await call(server, 'GET', '/v1/roles', as(t.accessToken))).json.items;
    const owner = roles.find((r: { isSystem: boolean }) => r.isSystem);
    expect(owner.permissions).toEqual(['*']);
    const edit = await call(server, 'PATCH', `/v1/roles/${owner.id}`, { ...as(t.accessToken), headers: { 'if-match': String(owner.version) }, body: { name: 'Hacked' } });
    expect(edit.json.code).toBe('system_role_immutable');
    const me = (await call(server, 'GET', '/v1/auth/me', as(t.accessToken))).json.user;
    const self = await call(server, 'PATCH', `/v1/users/${me.id}`, { ...as(t.accessToken), headers: { 'if-match': String(me.version) }, body: { status: 'disabled' } });
    expect(self.json.code).toBe('cannot_disable_self');
    const strip = await call(server, 'PUT', `/v1/users/${me.id}/roles`, { ...as(t.accessToken), body: { roleIds: [] } });
    expect(strip.status).toBe(409);
    expect(strip.json.code).toBe('last_owner');
  });
  it('rejects wildcard or unknown permissions on roles and keys', async () => {
    expect((await call(server, 'POST', '/v1/roles', { ...as(t.accessToken), body: { name: 'W', permissions: ['*'] } })).status).toBe(422);
    expect((await call(server, 'POST', '/v1/api-keys', { ...as(t.accessToken), body: { name: 'W', permissions: ['everything'] } })).status).toBe(422);
  });
  it('uses optimistic locking and never exposes credentials when listing users', async () => {
    const u = await newUser(t.accessToken, 'lock@example.com');
    expect((await call(server, 'PATCH', `/v1/users/${u.id}`, { ...as(t.accessToken), body: { displayName: 'A' } })).status).toBe(428);
    expect((await call(server, 'PATCH', `/v1/users/${u.id}`, { ...as(t.accessToken), headers: { 'if-match': '1' }, body: { displayName: 'A' } })).status).toBe(200);
    expect((await call(server, 'PATCH', `/v1/users/${u.id}`, { ...as(t.accessToken), headers: { 'if-match': '1' }, body: { displayName: 'B' } })).status).toBe(412);
    const list = await call(server, 'GET', '/v1/users?limit=2', as(t.accessToken));
    expect(list.json.items).toHaveLength(2);
    expect(list.json.nextCursor).toBeTruthy();
    expect(JSON.stringify(list.json)).not.toMatch(/argon2|passwordHash|mfaSecret/);
  });
  it('re-granting a revoked role works', async () => {
    const role = await newRole(t.accessToken, 'Flip', ['organization:read']);
    const u = await newUser(t.accessToken, 'flip@example.com', [role.id]);
    expect((await call(server, 'PUT', `/v1/users/${u.id}/roles`, { ...as(t.accessToken), body: { roleIds: [] } })).json.roleIds).toEqual([]);
    expect((await call(server, 'PUT', `/v1/users/${u.id}/roles`, { ...as(t.accessToken), body: { roleIds: [role.id] } })).json.roleIds).toEqual([role.id]);
  });
});

describe('API keys', () => {
  it('works with exactly the permissions it was given, is shown once, and can be revoked', async () => {
    const created = await call(server, 'POST', '/v1/api-keys', { ...as(t.accessToken), body: { name: 'reporting', permissions: ['organization:read'] } });
    expect(created.status).toBe(201);
    const key = created.json.key as string;
    expect(key).toMatch(/^ek_[0-9a-f]{32}_[0-9a-f]{32}_/);
    const asKey = as(key);
    expect((await call(server, 'GET', '/v1/companies', asKey)).status).toBe(200);
    expect((await call(server, 'POST', '/v1/companies', { ...asKey, body: { legalName: 'X' } })).status).toBe(403);
    expect((await call(server, 'GET', '/v1/auth/me', asKey)).json).toMatchObject({ kind: 'api_key', permissions: ['organization:read'] });
    expect((await call(server, 'POST', '/v1/auth/password', { ...asKey, body: { currentPassword: 'x', newPassword: STRONG } })).status).toBe(403);
    const list = await call(server, 'GET', '/v1/api-keys', as(t.accessToken));
    expect(JSON.stringify(list.json)).not.toContain(key.split('_')[3]);
    expect((await call(server, 'POST', `/v1/api-keys/${created.json.id}/revoke`, as(t.accessToken))).json.revokedAt).toBeTruthy();
    expect((await call(server, 'GET', '/v1/companies', asKey)).status).toBe(401);
  });
  it('rejects a key with a wrong secret, a wrong tenant, or an expired date', async () => {
    const created = await call(server, 'POST', '/v1/api-keys', { ...as(t.accessToken), body: { name: 'k2', permissions: ['organization:read'] } });
    const [p, tenantHex, keyHex, secret] = (created.json.key as string).split('_') as [string, string, string, string];
    expect((await call(server, 'GET', '/v1/companies', as(`${p}_${tenantHex}_${keyHex}_${'A'.repeat(secret.length)}`))).status).toBe(401);
    const other = await createTenantWithOwner(server, 'Key Other');
    expect((await call(server, 'GET', '/v1/companies', as(`${p}_${other.id.replaceAll('-', '')}_${keyHex}_${secret}`))).status).toBe(401);
    expect((await call(server, 'POST', '/v1/api-keys', { ...as(t.accessToken), body: { name: 'old', permissions: [], expiresAt: '2020-01-01T00:00:00Z' } })).status).toBe(422);
    const short = await call(server, 'POST', '/v1/api-keys', { ...as(t.accessToken), body: { name: 'short', permissions: ['organization:read'], expiresAt: new Date(Date.now() + 1500).toISOString() } });
    await new Promise((r) => setTimeout(r, 1800));
    expect((await call(server, 'GET', '/v1/companies', as(short.json.key))).status).toBe(401);
  });
});

describe('tenant separation of identity data', () => {
  it('keeps users, roles and keys of one tenant invisible to another', async () => {
    const a = await createTenantWithOwner(server, 'Sep A');
    const b = await createTenantWithOwner(server, 'Sep B');
    const aUser = await newUser(a.accessToken, 'only-in-a@example.com');
    expect((await call(server, 'GET', `/v1/users/${aUser.id}`, as(b.accessToken))).status).toBe(404);
    const listB = await call(server, 'GET', '/v1/users', as(b.accessToken));
    expect(listB.json.items.map((u: { email: string }) => u.email)).toEqual([b.ownerEmail]);
    // The same email may exist in two tenants.
    await newUser(b.accessToken, 'only-in-a@example.com');
    const aRole = await newRole(a.accessToken, 'A-only', ['organization:read']);
    expect((await call(server, 'GET', `/v1/roles/${aRole.id}`, as(b.accessToken))).status).toBe(404);
    expect((await call(server, 'POST', '/v1/users', { ...as(b.accessToken), body: { email: 'x@example.com', displayName: 'X', password: STRONG, roleIds: [aRole.id] } })).status).toBe(422);
  });
  it('the runtime role cannot write the tenant directory, and cannot see other tenants\' identity rows without a tenant', async () => {
    const pool = appPool(1);
    try {
      await expect(pool.query("INSERT INTO erp.tenant_directory (slug, tenant_id) VALUES ('x', gen_random_uuid())")).rejects.toMatchObject({ code: '42501' });
      for (const table of ['users', 'roles', 'sessions', 'api_keys', 'user_roles', 'mfa_recovery_codes']) {
        const { rows } = await pool.query(`SELECT count(*)::int AS n FROM erp.${table}`);
        expect(rows[0].n, table).toBe(0);
      }
    } finally { await pool.end(); }
  });
});

describe('tenant creation', () => {
  it('is closed by default, and open only when explicitly enabled', async () => {
    const body = { name: 'Self Serve', slug: uniqueSlug('ss'), owner: { email: 'me@example.com', displayName: 'Me', password: STRONG } };
    expect((await call(server, 'POST', '/v1/auth/signup', { body })).status).toBe(404);
    const open = await startServer({ SELF_SIGNUP_ENABLED: 'true' });
    try {
      const res = await call(open, 'POST', '/v1/auth/signup', { body });
      expect(res.status).toBe(201);
      expect((await call(open, 'POST', '/v1/auth/login', { body: { tenant: body.slug, email: 'me@example.com', password: STRONG } })).status).toBe(200);
    } finally { await open.close(); }
  });
  it('creates the tenant, owner role and owner atomically (a duplicate slug leaves nothing behind)', async () => {
    const slug = uniqueSlug('atom');
    const owner = { email: 'a@example.com', displayName: 'A', password: STRONG };
    const post = (name: string) => call(server, 'POST', '/v1/platform/tenants', { token: 'test-platform-admin-token-0123456789abcdef', body: { name, slug, owner } });
    expect((await post('One')).status).toBe(201);
    expect((await post('Two')).status).toBe(409);
    const raw = superPool();
    const { rows } = await raw.query("SELECT (SELECT count(*) FROM erp.tenant_directory WHERE slug = $1)::int AS dir, (SELECT count(*) FROM erp.users u JOIN erp.tenants t ON t.id = u.tenant_id WHERE t.slug = $1)::int AS users", [slug]);
    await raw.end();
    expect(rows[0]).toEqual({ dir: 1, users: 1 });
  });
});
