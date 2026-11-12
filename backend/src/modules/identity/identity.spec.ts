import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createRoleSchema, loginSchema, password, provisionTenantSchema } from './identity.schemas.js';
import { hashPassword, needsRehash, verifyPassword } from './password.js';
import { allows } from './permissions.js';
import { SecretBox } from './secret-box.js';
import { TokenService } from './tokens.js';
import { base32Decode, base32Encode, totpCode, verifyTotp } from './totp.js';

describe('passwords', () => {
  it('hashes with argon2id, verifies, and rejects wrong or malformed input', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(stored, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(stored, 'wrong')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
    expect(needsRehash(stored)).toBe(false);
    expect(needsRehash('$argon2id$v=19$m=4096,t=1,p=1$abc$def')).toBe(true);
  });
  it('requires a length, not a composition', () => {
    expect(password.safeParse('short').success).toBe(false);
    expect(password.safeParse('a long passphrase without digits').success).toBe(true);
  });
});

describe('access tokens', () => {
  const claims = { sub: 'u', tid: 't', sid: 's' };
  it('round-trips and expires', () => {
    const tokens = new TokenService(undefined);
    const token = tokens.issue(claims, 60, 1_000_000);
    expect(tokens.verify(token, 1_000_000 + 30_000)).toMatchObject(claims);
    expect(tokens.verify(token, 1_000_000 + 61_000)).toBeUndefined();
  });
  it('rejects tampering, foreign keys, other algorithms and garbage', () => {
    const tokens = new TokenService(undefined);
    const other = new TokenService(undefined);
    const token = tokens.issue(claims, 60);
    const [h, p, s] = token.split('.') as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), sub: 'admin' })).toString('base64url');
    expect(tokens.verify(`${h}.${forged}.${s}`)).toBeUndefined();
    expect(other.verify(token)).toBeUndefined();
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    expect(tokens.verify(`${none}.${p}.`)).toBeUndefined();
    expect(tokens.verify('a.b')).toBeUndefined();
    expect(tokens.verify('')).toBeUndefined();
  });
  it('keeps tokens from a rotated-out key valid while its public key is listed', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const oldPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const oldPublic = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const token = new TokenService(oldPem).issue(claims, 60);
    expect(new TokenService(undefined).verify(token)).toBeUndefined();
    expect(new TokenService(undefined, [oldPublic]).verify(token)).toMatchObject(claims);
  });
  it('refuses a non-Ed25519 signing key', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(() => new TokenService(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toThrow(/Ed25519/);
  });
});

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B test vector, SHA-1: secret "12345678901234567890", T = 59 s -> 94287082 (last 6 digits 287082).
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('matches the RFC vector', () => {
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });
  it('accepts one step of drift, returns the step, rejects the rest', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpCode(secret, step), now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 3), now)).toBeUndefined();
    expect(verifyTotp(secret, 'abcdef', now)).toBeUndefined();
  });
});

describe('secret box', () => {
  const box = new SecretBox(Buffer.alloc(32, 7));
  it('round-trips and binds a secret to its owner', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP', 'tenant:user');
    expect(sealed).not.toContain('JBSWY');
    expect(box.open(sealed, 'tenant:user')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => box.open(sealed, 'tenant:other')).toThrow();
    expect(() => box.open(sealed.slice(0, -2) + 'AA', 'tenant:user')).toThrow();
  });
});

describe('permissions and schemas', () => {
  it('wildcard allows everything; otherwise every required permission is needed', () => {
    expect(allows(new Set(['*']), ['users:write'])).toBe(true);
    expect(allows(new Set(['users:read']), ['users:read', 'users:write'])).toBe(false);
    expect(allows(new Set(['users:read']), [])).toBe(true);
  });
  it('roles can only hold known permissions, never the wildcard', () => {
    expect(createRoleSchema.safeParse({ name: 'A', permissions: ['users:read', 'users:read'] }).data?.permissions).toEqual(['users:read']);
    expect(createRoleSchema.safeParse({ name: 'A', permissions: ['*'] }).success).toBe(false);
    expect(createRoleSchema.safeParse({ name: 'A', permissions: ['nope:read'] }).success).toBe(false);
  });
  it('validates tenant slugs and normalises emails', () => {
    const owner = { email: ' Boss@Example.COM ', displayName: 'Boss', password: 'a long passphrase!' };
    expect(provisionTenantSchema.safeParse({ name: 'A', slug: 'acme-co', owner }).data?.owner.email).toBe('boss@example.com');
    for (const slug of ['A', 'ab', 'Acme', '-acme', 'acme-', 'a b']) expect(provisionTenantSchema.safeParse({ name: 'A', slug, owner }).success).toBe(false);
  });
  it('rejects unknown login fields', () => {
    expect(loginSchema.safeParse({ tenant: 'acme', email: 'a@b.co', password: 'x', admin: true }).success).toBe(false);
  });
});
