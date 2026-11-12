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
