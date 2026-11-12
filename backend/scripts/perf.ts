/**
 * Baseline measurements, not a benchmark suite: one process, one local PostgreSQL, so numbers are only comparable with
 * runs on the same machine. Provisions its own throwaway database (like the integration tests), then measures each HTTP
 * adapter and the cost of the tenant-scoped transaction wrapper.
 *
 *   TEST_PG_ADMIN_URL=postgresql://postgres@localhost:5434/postgres npm run perf
 */
import autocannon from 'autocannon';
import { generateKeyPairSync } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { createApplication } from '../src/bootstrap.js';
import { bootstrapDatabase } from '../src/db/bootstrap.js';
import { migrateUp } from '../src/db/migrator.js';
import { loadEnv } from '../src/config/env.js';
import { createAppPool, createDb } from '../src/platform/database/database.js';
import { UnitOfWork } from '../src/platform/database/unit-of-work.js';
import { companies } from '../src/db/schema.js';
import { PASSWORDS, urlFor } from '../test/support/urls.js';

const ADMIN = process.env['TEST_PG_ADMIN_URL'] ?? 'postgresql://postgres@localhost:5434/postgres';
const DURATION = Number(process.env['PERF_SECONDS'] ?? 8);
const CONNECTIONS = Number(process.env['PERF_CONNECTIONS'] ?? 32);
const JWT_KEY = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const TOKEN = 'perf-platform-admin-token-0123456789abcdef';

const dbName = `erp_perf_${process.pid}`;
const admin = new pg.Client({ connectionString: ADMIN });
await admin.connect();
await admin.query(`CREATE DATABASE ${dbName}`);
try {
  await bootstrapDatabase(urlFor(ADMIN, undefined, undefined, dbName), PASSWORDS);
  await migrateUp(urlFor(ADMIN, 'erp_migrator', PASSWORDS.migrator, dbName));
  const appUrl = urlFor(ADMIN, 'erp_app', PASSWORDS.app, dbName);

  const rows: string[][] = [];
  for (const adapter of ['fastify', 'node'] as const) {
    const env = loadEnv({ NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', LOG_LEVEL: 'silent', DATABASE_URL: appUrl, DATABASE_POOL_MAX: '20', PLATFORM_ADMIN_TOKEN: TOKEN, HTTP_ADAPTER: adapter, AUTH_JWT_PRIVATE_KEY: JWT_KEY } as NodeJS.ProcessEnv);
    const app = await createApplication(env);
    await app.listen(0, '127.0.0.1');
    const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');

    const created = await fetch(`${base}/v1/platform/tenants`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Perf', slug: `perf-${adapter}-${process.pid}`, owner: { email: 'perf@example.com', displayName: 'Perf', password: 'perf passphrase long enough' } }),
    });
    const tenant = ((await created.json()) as { id: string }).id;
    const login = await fetch(`${base}/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenant: `perf-${adapter}-${process.pid}`, email: 'perf@example.com', password: 'perf passphrase long enough' }),
    });
    const bearer = `Bearer ${((await login.json()) as { accessToken: string }).accessToken}`;
    const seedPool = createAppPool({ url: appUrl, max: 2, statementTimeoutMs: 60_000, idleInTransactionTimeoutMs: 60_000 });
    await new UnitOfWork(createDb(seedPool)).inTenant(tenant, async (tx) => {
      await tx.insert(companies).values(Array.from({ length: 200 }, (_, i) => ({ tenantId: tenant, id: uuidv7(), legalName: `Seed company ${i}` })));
    });
    await seedPool.end();

    const scenarios: { name: string; request: autocannon.Options }[] = [
      { name: 'GET /health/live (no database)', request: { url: `${base}/health/live` } },
      { name: 'GET /v1/tenant (auth + 1 read tx)', request: { url: `${base}/v1/tenant`, headers: { authorization: bearer } } },
      { name: 'GET /v1/companies?limit=50 (auth + list)', request: { url: `${base}/v1/companies?limit=50`, headers: { authorization: bearer } } },
      {
        name: 'POST /v1/companies (auth + write + audit + outbox)',
        request: { url: `${base}/v1/companies`, method: 'POST', headers: { authorization: bearer, 'content-type': 'application/json' }, body: JSON.stringify({ legalName: 'Perf Co', pan: 'ABCDE1234F' }) },
      },
    ];
    for (const scenario of scenarios) {
      const r = await autocannon({ ...scenario.request, connections: CONNECTIONS, duration: DURATION });
      rows.push([adapter, scenario.name, String(Math.round(r.requests.average)), String(r.latency.p50), String(r.latency.p97_5), String(r.latency.p99), String(r.non2xx), String(r.errors + r.timeouts)]);
    }
    await app.close();
  }

  // Cost of the tenant-scoped transaction wrapper, sequential, one connection.
  const pool = createAppPool({ url: appUrl, max: 1, statementTimeoutMs: 15_000, idleInTransactionTimeoutMs: 30_000 });
  const uow = new UnitOfWork(createDb(pool));
  const tenant = uuidv7();
  const measure = async (fn: () => Promise<unknown>, n = 3000) => {
    for (let i = 0; i < 200; i++) await fn();
    const t: number[] = [];
    for (let i = 0; i < n; i++) { const s = process.hrtime.bigint(); await fn(); t.push(Number(process.hrtime.bigint() - s) / 1e6); }
    t.sort((a, b) => a - b);
    return { mean: t.reduce((a, b) => a + b, 0) / n, p50: t[Math.floor(n * 0.5)]!, p95: t[Math.floor(n * 0.95)]!, p99: t[Math.floor(n * 0.99)]! };
  };
  const bare = await measure(() => pool.query('SELECT 1'));
  const wrapper = await measure(() => uow.inTenant(tenant, (tx) => tx.execute('select 1' as never), { readOnly: true }));
  await pool.end();

  const out: string[] = [];
  out.push(`Environment: ${cpus().length} vCPU (${cpus()[0]?.model}), ${(totalmem() / 2 ** 30).toFixed(1)} GiB RAM, Node ${process.version}, PostgreSQL local, load generator on the same machine.`);
  out.push(`autocannon: ${CONNECTIONS} connections, ${DURATION}s per scenario.\n`);
  out.push('| adapter | scenario | req/s | p50 ms | p97.5 ms | p99 ms | non-2xx | errors |');
  out.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  out.push('\nTenant-scoped transaction cost (sequential, 1 connection, 3000 iterations):\n');
  out.push('| call | mean ms | p50 ms | p95 ms | p99 ms |');
  out.push('| --- | ---: | ---: | ---: | ---: |');
  out.push(`| bare \`SELECT 1\` | ${bare.mean.toFixed(3)} | ${bare.p50.toFixed(3)} | ${bare.p95.toFixed(3)} | ${bare.p99.toFixed(3)} |`);
  out.push(`| \`inTenant\` (BEGIN, set_config, query, COMMIT) | ${wrapper.mean.toFixed(3)} | ${wrapper.p50.toFixed(3)} | ${wrapper.p95.toFixed(3)} | ${wrapper.p99.toFixed(3)} |`);
  console.log(out.join('\n'));
} finally {
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
}
