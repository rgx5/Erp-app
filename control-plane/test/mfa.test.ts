import { hash } from '@node-rs/argon2';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpCode } from '../src/totp.js';
import { testApp } from './support.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp({ REQUIRE_STAFF_MFA: 'true', DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') }); });
afterAll(async () => { await t.close(); });

const PASSWORD = 'a-long-staff-password-1';
async function user(role: 'admin' | 'viewer') {
  const email = `${role}-${Math.floor(Math.random() * 1e9)}@example.com`;
  const id = (await t.pool.query<{ id: string }>('INSERT INTO staff_users (id, email, display_name, password_hash, role) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id', [email, role, await hash(PASSWORD), role])).rows[0]?.id as string;
  return { id, email };
}
const login = (email: string, code?: string) => t.call('POST', '/auth/login', null, { email, password: PASSWORD, ...(code ? { code } : {}) });
const step = () => Math.floor(Date.now() / 30_000);

describe('staff two-step sign-in', () => {
  it('lets a new person sign in but only to set it up, then does the full cycle', async () => {
    const u = await user('admin');
    const first = await login(u.email);
    expect(first.status).toBe(200); expect(first.json.mfaSetupRequired).toBe(true);
    expect((await t.call('GET', '/fleet', first.json.token)).json.code).toBe('mfa_setup_required');
    expect((await t.call('GET', '/me', first.json.token)).status).toBe(200);
    const enrol = await t.call('POST', '/auth/mfa/enrol', first.json.token);
    expect(enrol.json.otpauthUri).toContain('otpauth://totp/');
    expect((await t.call('POST', '/auth/mfa/activate', first.json.token, { code: '000000' })).status).toBe(422);
    const secret = enrol.json.secret as string;
    const activated = await t.call('POST', '/auth/mfa/activate', first.json.token, { code: totpCode(secret, step()) });
    expect(activated.status).toBe(200); expect(activated.json.recoveryCodes).toHaveLength(8);
    expect((await t.call('GET', '/fleet', first.json.token)).status).toBe(200); // now allowed
    expect((await t.call('POST', '/auth/mfa/enrol', first.json.token)).json.code).toBe('mfa_enabled');

    // later sign-ins need the code; the same code cannot be used twice
    expect((await login(u.email)).json.code).toBe('mfa_required');
    expect((await login(u.email, totpCode(secret, step()))).json.code).toBe('invalid_code'); // that step was used to activate
    const next = await login(u.email, totpCode(secret, step() + 1));
    expect(next.status).toBe(200); expect(next.json.mfaSetupRequired).toBe(false);
    expect((await login(u.email, totpCode(secret, step() + 1))).json.code).toBe('invalid_code'); // replay refused
    // a recovery code works once
    const rc = (activated.json.recoveryCodes as string[])[0] as string;
    expect((await login(u.email, rc)).status).toBe(200);
    expect((await login(u.email, rc)).json.code).toBe('invalid_code');
  });

  it('locks an account that keeps guessing codes', async () => {
    const u = await user('viewer');
    const s = (await login(u.email)).json.token as string;
    const secret = (await t.call('POST', '/auth/mfa/enrol', s)).json.secret as string;
    await t.call('POST', '/auth/mfa/activate', s, { code: totpCode(secret, step()) });
    for (let i = 0; i < 5; i++) expect((await login(u.email, '123456')).status).toBe(401);
    expect((await login(u.email, totpCode(secret, step() + 1))).json.code).toBe('locked');
  });

  it('lets an admin reset a lost phone, which ends the person\'s sessions', async () => {
    const admin = await user('admin'); const other = await user('viewer');
    const as = (await login(admin.email)).json.token as string;
    const aSecret = (await t.call('POST', '/auth/mfa/enrol', as)).json.secret as string;
    await t.call('POST', '/auth/mfa/activate', as, { code: totpCode(aSecret, step()) });
    const os = (await login(other.email)).json.token as string;
    const oSecret = (await t.call('POST', '/auth/mfa/enrol', os)).json.secret as string;
    await t.call('POST', '/auth/mfa/activate', os, { code: totpCode(oSecret, step()) });
    expect((await t.call('POST', `/staff/${other.id}/mfa/reset`, os)).status).toBe(403);
    expect((await t.call('POST', `/staff/${other.id}/mfa/reset`, as)).status).toBe(200);
    expect((await t.call('GET', '/me', os)).status).toBe(401);
    expect((await login(other.email)).json.mfaSetupRequired).toBe(true);
  });
});
