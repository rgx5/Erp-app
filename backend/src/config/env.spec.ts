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
  it('refuses the dev-header tenant mode in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/dev-header/);
  });
  it('requires a database url and reports every problem', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/);
  });
  it('rejects a short platform token', () => {
    expect(() => loadEnv({ ...base, PLATFORM_ADMIN_TOKEN: 'short' })).toThrow(/PLATFORM_ADMIN_TOKEN/);
  });
});
