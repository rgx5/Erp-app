import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRetention } from '../../src/maintenance/retention.js';
import { call, createTenantWithOwner, startServer, superPool, testDb, type TestServer } from '../support/harness.js';

let server: TestServer;
const supers = superPool();
const migrator = new pg.Pool({ connectionString: testDb().migratorUrl, max: 2 });
beforeAll(async () => { server = await startServer(); });
afterAll(async () => { await server.close(); await supers.end(); await migrator.end(); });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const count = async (table: string, tenant: string) => Number((await supers.query(`SELECT COUNT(*)::int AS n FROM erp.${table} WHERE tenant_id = $1`, [tenant])).rows[0].n);

describe('retention', () => {
  it('purges only what has aged out of operational tables, in batches, and never touches the audit log or documents', async () => {
    const t = await createTenantWithOwner(server, 'Retention Co');
    // generate idempotency keys, outbox events and sessions
    for (let i = 0; i < 4; i++) {
      const r = await call(server, 'POST', '/v1/parties', { token: t.accessToken, headers: { 'idempotency-key': `key-${i}` }, body: { code: `P${i}`, legalName: `Party ${i}`, isCustomer: true, gstTreatment: 'consumer' } });
      expect(r.status).toBe(201);
    }
    await call(server, 'POST', '/v1/auth/login', { body: { tenant: t.slug, email: t.ownerEmail, password: 'owner passphrase for tests' } });
    const before = { idem: await count('idempotency_keys', t.id), events: await count('outbox_events', t.id), sessions: await count('sessions', t.id), audit: await count('audit_log', t.id), parties: await count('parties', t.id) };
    expect(before.idem).toBeGreaterThanOrEqual(4);
    expect(before.events).toBeGreaterThan(0);
    // age half of everything past the retention windows; keep one idempotency key fresh, and one outbox event dead-lettered
    await supers.query("UPDATE erp.idempotency_keys SET expires_at = now() - interval '3 days' WHERE tenant_id = $1 AND key <> 'key-3'", [t.id]);
    await supers.query("UPDATE erp.sessions SET expires_at = now() - interval '400 days' WHERE tenant_id = $1 AND id IN (SELECT id FROM erp.sessions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1)", [t.id]);
    await supers.query("UPDATE erp.outbox_dispatch SET done_at = now() - interval '45 days', dead_at = NULL WHERE tenant_id = $1", [t.id]);
    const dead = (await supers.query("SELECT event_id FROM erp.outbox_dispatch WHERE tenant_id = $1 LIMIT 1", [t.id])).rows[0].event_id as string;
    await supers.query("UPDATE erp.outbox_dispatch SET dead_at = now() - interval '45 days' WHERE event_id = $1", [dead]);
    const dry = await runRetention(migrator, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.idempotencyKeys).toBeGreaterThanOrEqual(3);
    expect(await count('idempotency_keys', t.id)).toBe(before.idem); // a dry run deletes nothing
    const done = await runRetention(migrator, { batchSize: 2 }); // tiny batches exercise the loop
    expect(done.idempotencyKeys).toBeGreaterThanOrEqual(3);
    expect(done.outboxEvents).toBeGreaterThanOrEqual(before.events - 1);
    expect(done.sessions).toBeGreaterThanOrEqual(1);
    expect(await count('idempotency_keys', t.id)).toBe(before.idem - 3); // only the three expired ones
    expect((await supers.query("SELECT 1 FROM erp.idempotency_keys WHERE tenant_id = $1 AND key = 'key-3'", [t.id])).rowCount).toBe(1);
    expect((await supers.query('SELECT 1 FROM erp.outbox_events WHERE id = $1', [dead])).rowCount).toBe(1); // dead letters stay for investigation
    expect(await count('sessions', t.id)).toBe(before.sessions - 1);
    expect(await count('audit_log', t.id)).toBe(before.audit); // never purged
    expect(await count('parties', t.id)).toBe(before.parties);
    const again = await runRetention(migrator);
    expect(again.idempotencyKeys + again.outboxEvents + again.sessions).toBe(0); // idempotent
    // the replayed idempotent request that survived still answers from its stored response
    const replay = await call(server, 'POST', '/v1/parties', { token: t.accessToken, headers: { 'idempotency-key': 'key-3' }, body: { code: 'P3', legalName: 'Party 3', isCustomer: true, gstTreatment: 'consumer' } });
    expect(replay.status).toBe(201);
  });

  it('does not give the runtime role any way to delete', async () => {
    const app = new pg.Pool({ connectionString: testDb().appUrl, max: 1 });
    try {
      await expect(app.query('DELETE FROM erp.idempotency_keys')).rejects.toMatchObject({ code: '42501' });
      await expect(app.query('DELETE FROM erp.sessions')).rejects.toMatchObject({ code: '42501' });
      await expect(app.query('DELETE FROM erp.audit_log')).rejects.toMatchObject({ code: '42501' });
    } finally { await app.end(); }
  });
});

describe('rate limiting', () => {
  it('limits a client per window, tells it how long to wait, exempts health probes, and recovers', async () => {
    const limited = await startServer({ RATE_LIMIT_PER_WINDOW: '5', RATE_LIMIT_WINDOW_SECONDS: '1' });
    try {
      const t = await createTenantWithOwner(limited, 'Rate Co').catch(() => undefined);
      const statuses: number[] = [];
      let last: Awaited<ReturnType<typeof call>> | undefined;
      for (let i = 0; i < 8; i++) { last = await call(limited, 'GET', '/v1/auth/me', { token: t?.accessToken ?? 'x' }); statuses.push(last.status); }
      expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
      expect(last?.json).toMatchObject({ code: 'rate_limited' });
      expect(last?.headers.get('retry-after')).toBeTruthy();
      expect(last?.headers.get('ratelimit-limit')).toBe('5');
      expect(last?.headers.get('ratelimit-remaining')).toBe('0');
      await sleep(1100);
      expect((await call(limited, 'GET', '/health/live')).status).toBe(200);
      const probes = await Promise.all(Array.from({ length: 20 }, () => call(limited, 'GET', '/health/live')));
      expect(probes.every((p) => p.status === 200)).toBe(true); // never limited
      await sleep(1100);
      expect((await call(limited, 'GET', '/v1/auth/me', { token: t?.accessToken ?? 'x' })).status).not.toBe(429); // a new window
    } finally { await limited.close(); }
  });

  it('is off by default', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => call(server, 'GET', '/health/live')));
    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});

describe('principal cache', () => {
  it('trusts a very recent answer for the configured time, but forgets at once what the API revokes', async () => {
    const cached = await startServer({ AUTH_PRINCIPAL_CACHE_TTL_MS: '600' });
    try {
      const t = await createTenantWithOwner(cached, 'Cache Co');
      const key = async (name: string) => (await call(cached, 'POST', '/v1/api-keys', { token: t.accessToken, body: { name, permissions: ['masterdata:read'] } })).json as { key: string; id: string };
      const a = await key('a');
      expect((await call(cached, 'GET', '/v1/parties?limit=1', { token: a.key })).status).toBe(200);
      // revoked behind the API's back (straight in the database): the cached answer lives until the TTL ends, then it stops
      await supers.query('UPDATE erp.api_keys SET revoked_at = now() WHERE id = $1', [a.id]);
      expect((await call(cached, 'GET', '/v1/parties?limit=1', { token: a.key })).status).toBe(200);
      await sleep(700);
      expect((await call(cached, 'GET', '/v1/parties?limit=1', { token: a.key })).status).toBe(401);
      // revoked through the API: forgotten immediately, no waiting
      const b = await key('b');
      expect((await call(cached, 'GET', '/v1/parties?limit=1', { token: b.key })).status).toBe(200);
      expect((await call(cached, 'POST', `/v1/api-keys/${b.id}/revoke`, { token: t.accessToken })).status).toBeLessThan(300);
      expect((await call(cached, 'GET', '/v1/parties?limit=1', { token: b.key })).status).toBe(401);
    } finally { await cached.close(); }
  });

  it('checks the database every time by default', async () => {
    const t = await createTenantWithOwner(server, 'NoCache Co');
    const k = (await call(server, 'POST', '/v1/api-keys', { token: t.accessToken, body: { name: 'k', permissions: ['masterdata:read'] } })).json as { key: string; id: string };
    expect((await call(server, 'GET', '/v1/parties?limit=1', { token: k.key })).status).toBe(200);
    await supers.query('UPDATE erp.api_keys SET revoked_at = now() WHERE id = $1', [k.id]);
    expect((await call(server, 'GET', '/v1/parties?limit=1', { token: k.key })).status).toBe(401);
  });
});
