import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = { DATABASE_URL: 'postgresql://erp_app:x@localhost:5432/erp' };

describe('loadEnv', () => {
  it('applies defaults', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(8080);
    expect(env.HTTP_ADAPTER).toBe('fastify');
    expect(env.SWAGGER_ENABLED).toBe(true);
  });
  it('lets Swagger be switched off explicitly', () => {
    expect(loadEnv({ ...base, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED).toBe(false);
  });
  it('requires signing and encryption keys in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/AUTH_JWT_PRIVATE_KEY[\s\S]*DATA_ENCRYPTION_KEY/);
  });
  it('rejects an encryption key that is not 32 bytes', () => {
    expect(() => loadEnv({ ...base, DATA_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
  });
  it('reads the CORS allow-list as exact origins and refuses a wildcard', () => {
    expect(loadEnv(base).CORS_ALLOWED_ORIGINS).toEqual([]);
    expect(loadEnv({ ...base, CORS_ALLOWED_ORIGINS: ' app://onesync, https://erp.example.com ,' }).CORS_ALLOWED_ORIGINS).toEqual(['app://onesync', 'https://erp.example.com']);
    expect(() => loadEnv({ ...base, CORS_ALLOWED_ORIGINS: '*' })).toThrow(/wildcard/);
  });
  it('keeps self-signup off unless enabled', () => {
    expect(loadEnv(base).SELF_SIGNUP_ENABLED).toBe(false);
    expect(loadEnv({ ...base, SELF_SIGNUP_ENABLED: 'true' }).SELF_SIGNUP_ENABLED).toBe(true);
  });
  it('requires a database url and reports every problem', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/);
  });
  it('rejects a short platform token', () => {
    expect(() => loadEnv({ ...base, PLATFORM_ADMIN_TOKEN: 'short' })).toThrow(/PLATFORM_ADMIN_TOKEN/);
  });
});

describe('configuration from a hosting panel', () => {
  it('treats empty optional settings as unset and accepts keys with \\n for line breaks', () => {
    const env = loadEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://a:b@h/erp', AUTH_JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----', DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), LICENCE_PUBLIC_KEY: '', SITE_ID: '', MIN_CLIENT_VERSION: '' } as NodeJS.ProcessEnv);
    expect(env.AUTH_JWT_PRIVATE_KEY).toContain('\n'); expect(env.LICENCE_PUBLIC_KEY).toBeUndefined(); expect(env.SITE_ID).toBeUndefined();
  });
});
