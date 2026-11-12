import type { INestApplication } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import pg from 'pg';
import { inject } from 'vitest';
import { createApplication } from '../../src/bootstrap.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { urlFor } from './urls.js';
import { gstinCheckCharacter } from '../../src/modules/organization/gstin.js';
import { createAppPool, createDb } from '../../src/platform/database/database.js';
import { UnitOfWork } from '../../src/platform/database/unit-of-work.js';

export const PLATFORM_TOKEN = 'test-platform-admin-token-0123456789abcdef';
/** One signing key for every server a test run starts, so a token from one server is valid on the next. */
const JWT_KEY = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
export const OWNER_PASSWORD = 'owner passphrase for tests';

export const testDb = () => inject('testDb');

/** The real runtime role, over a real pool. `max` is small on purpose in tests that need connection reuse. */
export function appPool(max = 5): pg.Pool {
  return createAppPool({ url: testDb().appUrl, max, statementTimeoutMs: 15_000, idleInTransactionTimeoutMs: 30_000 });
}
/** A superuser connection to the test database, for assertions that must see past RLS. Never used by the application. */
export function superPool(): pg.Pool {
  return new pg.Pool({ connectionString: urlFor(testDb().adminUrl, undefined, undefined, testDb().dbName), max: 1 });
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
    AUTH_JWT_PRIVATE_KEY: JWT_KEY,
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
  options: { tenant?: string; as?: string; token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string> } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { ...options.headers };
  // `tenant` = act as that tenant's owner (the token was obtained by createTenant). `token` = an explicit credential.
  const bearer = options.token ?? (options.tenant ? owners.get(options.tenant)?.accessToken : undefined);
  if (options.tenant && !bearer) throw new Error(`no owner session for tenant ${options.tenant}`);
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
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

export interface TenantHandle {
  id: string;
  slug: string;
  ownerEmail: string;
  accessToken: string;
  refreshToken: string;
}
const owners = new Map<string, TenantHandle>();

/** Provisions a tenant with an owner (platform endpoint), signs the owner in, and remembers the session. Returns the tenant id. */
export async function createTenant(server: TestServer, name = 'Acme'): Promise<string> {
  const handle = await createTenantWithOwner(server, name);
  return handle.id;
}

export async function createTenantWithOwner(server: TestServer, name = 'Acme'): Promise<TenantHandle> {
  const slug = uniqueSlug();
  const ownerEmail = `owner@${slug}.example.com`;
  const created = await call(server, 'POST', '/v1/platform/tenants', {
    token: PLATFORM_TOKEN,
    body: { name, slug, owner: { email: ownerEmail, displayName: 'Owner', password: OWNER_PASSWORD } },
  });
  if (created.status !== 201) throw new Error(`createTenant failed: ${created.status} ${JSON.stringify(created.json)}`);
  const login = await call(server, 'POST', '/v1/auth/login', { body: { tenant: slug, email: ownerEmail, password: OWNER_PASSWORD } });
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.json)}`);
  const handle = { id: created.json.id as string, slug, ownerEmail, accessToken: login.json.accessToken as string, refreshToken: login.json.refreshToken as string };
  owners.set(handle.id, handle);
  return handle;
}

/** A structurally valid GSTIN (correct check character) for the given state and PAN. */
export function makeGstin(stateCode: string, pan: string, entity = '1'): string {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return first14 + gstinCheckCharacter(first14);
}

/** A company with one GST registration (and the registration's id), through the real API. */
export async function createRegistration(server: TestServer, tenant: string, state = '27', pan = 'ABCDE1234F', entity = '1'): Promise<{ companyId: string; registrationId: string }> {
  const company = await call(server, 'POST', '/v1/companies', { tenant, body: { legalName: `Co ${uniqueSlug('c')}`, pan } });
  if (company.status !== 201) throw new Error(`company failed: ${JSON.stringify(company.json)}`);
  const registration = await call(server, 'POST', `/v1/companies/${company.json.id}/gst-registrations`, {
    tenant,
    body: { gstin: makeGstin(state, pan, entity), legalName: 'Co', effectiveFrom: '2024-04-01' },
  });
  if (registration.status !== 201) throw new Error(`registration failed: ${JSON.stringify(registration.json)}`);
  return { companyId: company.json.id as string, registrationId: registration.json.id as string };
}
