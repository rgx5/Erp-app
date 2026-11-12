import type { INestApplication } from '@nestjs/common';
import pg from 'pg';
import { inject } from 'vitest';
import { createApplication } from '../../src/bootstrap.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { gstinCheckCharacter } from '../../src/modules/organization/gstin.js';
import { createAppPool, createDb } from '../../src/platform/database/database.js';
import { UnitOfWork } from '../../src/platform/database/unit-of-work.js';

export const PLATFORM_TOKEN = 'test-platform-admin-token-0123456789abcdef';

export const testDb = () => inject('testDb');

/** The real runtime role, over a real pool. `max` is small on purpose in tests that need connection reuse. */
export function appPool(max = 5): pg.Pool {
  return createAppPool({ url: testDb().appUrl, max, statementTimeoutMs: 15_000, idleInTransactionTimeoutMs: 30_000 });
}
export const unitOfWork = (pool: pg.Pool) => new UnitOfWork(createDb(pool));

export interface TestServer {
  app: INestApplication;
  base: string;
  env: Env;
  close(): Promise<void>;
}

export async function startServer(overrides: Record<string, string | undefined> = {}): Promise<TestServer> {
  const env = loadEnv({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    LOG_LEVEL: 'silent',
    DATABASE_URL: testDb().appUrl,
    DATABASE_POOL_MAX: '10',
    PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN,
    HTTP_ADAPTER: process.env['TEST_HTTP_ADAPTER'] ?? 'fastify',
    ...overrides,
  } as NodeJS.ProcessEnv);
  const app = await createApplication(env);
  await app.listen(0, '127.0.0.1');
  return { app, env, base: (await app.getUrl()).replace('[::1]', '127.0.0.1'), close: () => app.close() };
}

export interface ApiResponse {
  status: number;
  headers: Headers;
  json: any; // eslint-disable-line
}

export async function call(
  server: TestServer,
  method: string,
  path: string,
  options: { tenant?: string; token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.tenant) headers['x-tenant-id'] = options.tenant;
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  let body: string | undefined = options.rawBody;
  if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }
  const response = await fetch(server.base + path, { method, headers, ...(body !== undefined ? { body } : {}) });
  const text = await response.text();
  let json: unknown = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { /* not JSON */ }
  return { status: response.status, headers: response.headers, json };
}

let counter = 0;
export const uniqueSlug = (prefix = 't') => `${prefix}-${process.pid}-${Date.now().toString(36)}-${++counter}`;

export async function createTenant(server: TestServer, name = 'Acme'): Promise<string> {
  const response = await call(server, 'POST', '/v1/platform/tenants', { token: PLATFORM_TOKEN, body: { name, slug: uniqueSlug() } });
  if (response.status !== 201) throw new Error(`createTenant failed: ${response.status} ${JSON.stringify(response.json)}`);
  return response.json.id as string;
}

/** A structurally valid GSTIN (correct check character) for the given state and PAN. */
export function makeGstin(stateCode: string, pan: string, entity = '1'): string {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return first14 + gstinCheckCharacter(first14);
}
