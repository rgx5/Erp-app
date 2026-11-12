import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnitOfWork } from '../../src/platform/database/unit-of-work.js';
import { OutboxRelay, OutboxRegistry, type StoredEvent } from '../../src/platform/services/outbox.relay.js';
import { OutboxService } from '../../src/platform/services/outbox.service.js';
import { appPool, call, createTenant, createTenantWithOwner, startServer, superPool, type TestServer } from '../support/harness.js';

let server: TestServer;
let tenant: string;
let uow: UnitOfWork;
let relay: OutboxRelay;
let registry: OutboxRegistry;
let outbox: OutboxService;
const supers = superPool();

beforeAll(async () => {
  server = await startServer({ OUTBOX_MAX_ATTEMPTS: '3', IDEMPOTENCY_TTL_SECONDS: '3600' });
  tenant = await createTenant(server, 'Platform Services Co');
  uow = server.app.get(UnitOfWork);
  relay = server.app.get(OutboxRelay);
  registry = server.app.get(OutboxRegistry);
  outbox = server.app.get(OutboxService);
});
afterAll(async () => { await server.close(); await supers.end(); });

const audit = async (where: string, params: unknown[] = []) =>
  (await supers.query(`SELECT * FROM erp.audit_log WHERE tenant_id = $1 ${where} ORDER BY id`, [tenant, ...params])).rows;

describe('audit log', () => {
  it('records who did what, with the request id, in the same transaction as the change', async () => {
    const res = await call(server, 'POST', '/v1/companies', { tenant, body: { legalName: 'Audited Co' } });
    expect(res.status).toBe(201);
    const rows = await audit("AND action = 'company.created' AND entity_id = $2", [res.json.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_type: 'user', outcome: 'success', entity_type: 'company', request_id: res.headers.get('x-request-id') });
    expect(rows[0].details).toMatchObject({ legalName: 'Audited Co' });
    expect(rows[0].actor_id).toBeTruthy();
  });
  it('records sign-ins, failures and lockouts without ever storing secrets', async () => {
    const t = await createTenantWithOwner(server, 'Audit Auth');
    await call(server, 'POST', '/v1/auth/login', { body: { tenant: t.slug, email: t.ownerEmail, password: 'definitely wrong password' } });
    const ok = await call(server, 'POST', '/v1/auth/login', { body: { tenant: t.slug, email: t.ownerEmail, password: 'owner passphrase for tests' } });
    expect(ok.status).toBe(200);
    const { rows } = await supers.query("SELECT action, outcome, details::text AS d FROM erp.audit_log WHERE tenant_id = $1 AND action LIKE 'auth.%' ORDER BY id", [t.id]);
    expect(rows.map((r) => `${r.action}:${r.outcome}`)).toEqual(['auth.login_succeeded:success', 'auth.login_failed:failure', 'auth.login_succeeded:success']);
    expect(JSON.stringify(rows)).not.toMatch(/wrong password|passphrase|argon2|eyJ/);
  });
  it('never records an API key secret', async () => {
    const res = await call(server, 'POST', '/v1/api-keys', { tenant, body: { name: 'audited', permissions: ['organization:read'] } });
    const secret = (res.json.key as string).split('_')[3] as string;
    const rows = await audit("AND action = 'api_key.created'");
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(rows.at(-1)?.details).toMatchObject({ name: 'audited', permissions: ['organization:read'] });
  });
  it('leaves nothing behind when the change itself fails', async () => {
    const before = (await audit("AND action = 'user.created'")).length;
    const body = { email: 'dup@example.com', displayName: 'D', password: 'a long passphrase!!' };
    expect((await call(server, 'POST', '/v1/users', { tenant, body })).status).toBe(201);
    expect((await call(server, 'POST', '/v1/users', { tenant, body })).status).toBe(409);
    expect((await audit("AND action = 'user.created'")).length).toBe(before + 1);
  });
  it('is readable newest-first with filters and pagination, only with audit:read, and only within the tenant', async () => {
    const page1 = await call(server, 'GET', '/v1/audit-events?limit=2', { tenant });
    expect(page1.status).toBe(200);
    expect(page1.json.items).toHaveLength(2);
    expect(page1.json.items[0].id > page1.json.items[1].id).toBe(true);
    const page2 = await call(server, 'GET', `/v1/audit-events?limit=2&cursor=${page1.json.nextCursor}`, { tenant });
    expect(page2.json.items[0].id < page1.json.items[1].id).toBe(true);
    const only = await call(server, 'GET', '/v1/audit-events?action=company.created', { tenant });
    expect(only.json.items.every((i: { action: string }) => i.action === 'company.created')).toBe(true);
    const failures = await call(server, 'GET', '/v1/audit-events?outcome=failure', { tenant });
    expect(failures.json.items.every((i: { outcome: string }) => i.outcome === 'failure')).toBe(true);

    const other = await createTenantWithOwner(server, 'Other Audit');
    const theirs = await call(server, 'GET', '/v1/audit-events?limit=200', { tenant: other.id });
    expect(theirs.json.items.length).toBeGreaterThan(0);
    const mine = new Set((await call(server, 'GET', '/v1/audit-events?limit=200', { tenant })).json.items.map((i: { id: string }) => i.id));
    for (const item of theirs.json.items) expect(mine.has(item.id)).toBe(false);

    const role = await call(server, 'POST', '/v1/roles', { tenant, body: { name: 'No audit', permissions: ['organization:read'] } });
    await call(server, 'POST', '/v1/users', { tenant, body: { email: 'noaudit@example.com', displayName: 'N', password: 'a long passphrase!!', roleIds: [role.json.id] } });
    const login = await call(server, 'POST', '/v1/auth/login', { body: { tenant: (await call(server, 'GET', '/v1/tenant', { tenant })).json.slug, email: 'noaudit@example.com', password: 'a long passphrase!!' } });
    expect((await call(server, 'GET', '/v1/audit-events', { token: login.json.accessToken })).status).toBe(403);
  });
  it('is append-only for the runtime role and for everyone else, even a superuser', async () => {
    const [row] = await audit('');
    const pool = appPool(1);
    try {
      await expect(pool.query('UPDATE erp.audit_log SET action = $1', ['x.y'])).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('DELETE FROM erp.audit_log')).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('TRUNCATE erp.audit_log')).rejects.toMatchObject({ code: '42501' });
    } finally { await pool.end(); }
    await expect(supers.query('UPDATE erp.audit_log SET action = $1 WHERE id = $2', ['x.y', row.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('DELETE FROM erp.audit_log WHERE id = $1', [row.id])).rejects.toMatchObject({ code: '55000' });
    await expect(supers.query('TRUNCATE erp.audit_log')).rejects.toMatchObject({ code: '55000' });
  });
});

describe('idempotency', () => {
  const post = (key: string | undefined, body: object, who: string = tenant) =>
    call(server, 'POST', '/v1/companies', { tenant: who, ...(key ? { headers: { 'idempotency-key': key } } : {}), body });
  const companiesNamed = async (name: string, who = tenant) =>
    Number((await supers.query('SELECT count(*) AS n FROM erp.companies WHERE tenant_id = $1 AND legal_name = $2', [who, name])).rows[0].n);

  it('replays the original response for a retried request and does the work once', async () => {
    const first = await post('key-replay-1', { legalName: 'Once Co' });
    const second = await post('key-replay-1', { legalName: 'Once Co' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.json).toEqual(first.json);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    expect(await companiesNamed('Once Co')).toBe(1);
    const events = await supers.query("SELECT count(*)::int AS n FROM erp.outbox_events WHERE tenant_id = $1 AND aggregate_id = $2", [tenant, first.json.id]);
    expect(events.rows[0].n).toBe(1); // the replay did not publish again
  });
  it('treats key order in the body as irrelevant but any other difference as a conflict', async () => {
    await post('key-conflict-1', { legalName: 'Conflict Co', baseCurrency: 'INR' });
    expect((await post('key-conflict-1', { baseCurrency: 'INR', legalName: 'Conflict Co' })).headers.get('idempotent-replayed')).toBe('true');
    const different = await post('key-conflict-1', { legalName: 'Different Co' });
    expect(different.status).toBe(422);
    expect(different.json.code).toBe('idempotency_key_reused');
    expect(await companiesNamed('Different Co')).toBe(0);
  });
  it('does exactly one piece of work when the same request arrives many times at once', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => post('key-race-1', { legalName: 'Race Co' })));
    expect(new Set(results.map((r) => r.status))).toEqual(new Set([201]));
    expect(new Set(results.map((r) => r.json.id)).size).toBe(1);
    expect(await companiesNamed('Race Co')).toBe(1);
    expect(results.filter((r) => r.headers.get('idempotent-replayed') === 'true')).toHaveLength(11);
  });
  it('does not burn the key when the request fails, so a corrected retry works', async () => {
    const bad = await post('key-fail-1', { legalName: ' ' });
    expect(bad.status).toBe(422);
    const good = await post('key-fail-1', { legalName: 'Fixed Co' });
    expect(good.status).toBe(201);
    expect(good.headers.get('idempotent-replayed')).toBeNull();
  });
  it('scopes keys to the tenant', async () => {
    const other = await createTenant(server, 'Idem Other');
    const a = await post('shared-key', { legalName: 'Same Name' });
    const b = await post('shared-key', { legalName: 'Same Name' }, other);
    expect(a.json.id).not.toBe(b.json.id);
    expect(b.headers.get('idempotent-replayed')).toBeNull();
  });
  it('is optional by default, validates the key, and lets an expired key be reused', async () => {
    expect((await post(undefined, { legalName: 'No Key Co' })).status).toBe(201);
    expect((await post(undefined, { legalName: 'No Key Co' })).status).toBe(201); // no key => no dedupe
    expect((await post('bad key with spaces', { legalName: 'X' })).status).toBe(422);
    const first = await post('key-expire-1', { legalName: 'Expiring Co' });
    await supers.query("UPDATE erp.idempotency_keys SET expires_at = now() - interval '1 minute' WHERE tenant_id = $1 AND key = 'key-expire-1'", [tenant]);
    const again = await post('key-expire-1', { legalName: 'Expiring Co' });
    expect(again.status).toBe(201);
    expect(again.json.id).not.toBe(first.json.id);
  });
  it('is bound to the caller: another user cannot replay someone else\'s key', async () => {
    const t = await createTenantWithOwner(server, 'Idem Callers');
    const first = await call(server, 'POST', '/v1/companies', { tenant: t.id, headers: { 'idempotency-key': 'caller-key' }, body: { legalName: 'Mine' } });
    expect(first.status).toBe(201);
    const key = await call(server, 'POST', '/v1/api-keys', { tenant: t.id, body: { name: 'k', permissions: ['organization:write'] } });
    const second = await call(server, 'POST', '/v1/companies', { token: key.json.key, headers: { 'idempotency-key': 'caller-key' }, body: { legalName: 'Mine' } });
    expect(second.status).toBe(422);
  });
});

describe('transactional outbox', () => {
  const eventType = 'test.thing_happened';
  const received: { id: string; tenant: string; boundTenant: string | undefined }[] = [];
  let failuresLeft = 0;

  beforeAll(() => {
    registry.register({
      name: 'test-consumer',
      eventTypes: [eventType],
      async handle(event: StoredEvent, tx) {
        if (failuresLeft > 0) { failuresLeft--; throw new Error('boom'); }
        const bound = (await tx.execute(sql`select current_setting('app.tenant_id', true) as t`)).rows[0] as { t: string };
        received.push({ id: event.id, tenant: event.tenantId, boundTenant: bound.t });
      },
    });
  });
  const publish = (who: string, aggregateId = uuidv7()) =>
    uow.inTenant(who, (tx) => outbox.publish(tx, who, { eventType, aggregateType: 'thing', aggregateId, payload: { n: 1 } }));
  const drainAll = async () => { for (let i = 0; i < 20 && (await relay.drainOnce()) > 0; i++); };

  it('publishes an event only if the business transaction commits', async () => {
    const aggregateId = uuidv7();
    await expect(uow.inTenant(tenant, async (tx) => {
      await outbox.publish(tx, tenant, { eventType, aggregateType: 'thing', aggregateId, payload: {} });
      throw new Error('rolled back');
    })).rejects.toThrow('rolled back');
    const rows = await supers.query('SELECT count(*)::int AS n FROM erp.outbox_events WHERE aggregate_id = $1', [aggregateId]);
    expect(rows.rows[0].n).toBe(0);
    const dispatch = await supers.query('SELECT count(*)::int AS n FROM erp.outbox_dispatch d WHERE NOT EXISTS (SELECT 1 FROM erp.outbox_events e WHERE e.id = d.event_id)');
    expect(dispatch.rows[0].n).toBe(0);
  });
  it('delivers each committed event to its consumer once, inside that event\'s own tenant', async () => {
    await drainAll();
    received.length = 0;
    const other = await createTenant(server, 'Outbox Other');
    const a = await publish(tenant);
    const b = await publish(other);
    await drainAll();
    expect(received.map((r) => r.id).sort()).toEqual([a, b].sort());
    for (const r of received) expect(r.boundTenant).toBe(r.tenant);
    const dispatch = await supers.query('SELECT done_at, attempts FROM erp.outbox_dispatch WHERE event_id = $1', [a]);
    expect(dispatch.rows[0].done_at).toBeTruthy();
    await drainAll();
    expect(received).toHaveLength(2); // nothing is delivered twice
  });
  it('treats redelivery as a no-op because the consumer\'s done-mark commits with its work', async () => {
    received.length = 0;
    const id = await publish(tenant);
    await drainAll();
    expect(received).toHaveLength(1);
    await supers.query('UPDATE erp.outbox_dispatch SET done_at = NULL, locked_until = NULL, available_at = now() WHERE event_id = $1', [id]);
    await drainAll();
    expect(received).toHaveLength(1);
    const consumed = await supers.query('SELECT count(*)::int AS n FROM erp.outbox_consumed WHERE event_id = $1', [id]);
    expect(consumed.rows[0].n).toBe(1);
  });
  it('retries a failing consumer with backoff and then succeeds', async () => {
    received.length = 0;
    const id = await publish(tenant);
    failuresLeft = 1;
    await drainAll();
    expect(received).toHaveLength(0);
    const failed = (await supers.query('SELECT attempts, last_error, available_at > now() AS later, done_at FROM erp.outbox_dispatch WHERE event_id = $1', [id])).rows[0];
    expect(failed).toMatchObject({ attempts: 1, last_error: 'boom', later: true, done_at: null });
    await supers.query('UPDATE erp.outbox_dispatch SET available_at = now() WHERE event_id = $1', [id]);
    await drainAll();
    expect(received.map((r) => r.id)).toEqual([id]);
  });
  it('parks an event that keeps failing as dead instead of dropping it or retrying forever', async () => {
    const id = await publish(tenant);
    failuresLeft = 99;
    for (let i = 0; i < 4; i++) {
      await supers.query('UPDATE erp.outbox_dispatch SET available_at = now(), locked_until = NULL WHERE event_id = $1 AND dead_at IS NULL', [id]);
      await drainAll();
    }
    failuresLeft = 0;
    const row = (await supers.query('SELECT attempts, dead_at, last_error FROM erp.outbox_dispatch WHERE event_id = $1', [id])).rows[0];
    expect(row.dead_at).toBeTruthy();
    expect(row.attempts).toBe(3);
    expect(row.last_error).toBe('boom');
    const before = received.length;
    await drainAll();
    expect(received.length).toBe(before);
  });
  it('lets two relays work at the same time without delivering anything twice', async () => {
    await drainAll();
    received.length = 0;
    const ids = await Promise.all(Array.from({ length: 24 }, () => publish(tenant)));
    await Promise.all([relay.drainOnce(), relay.drainOnce(), relay.drainOnce()]);
    await drainAll();
    expect(received.map((r) => r.id).sort()).toEqual([...ids].sort());
  });
  it('keeps the delivery queue free of business data, and the runtime role cannot create or erase queue rows', async () => {
    const pool = appPool(1);
    try {
      await expect(pool.query('INSERT INTO erp.outbox_dispatch (event_id, tenant_id) VALUES (gen_random_uuid(), gen_random_uuid())')).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('DELETE FROM erp.outbox_dispatch')).rejects.toMatchObject({ code: '42501' });
      await expect(pool.query('UPDATE erp.outbox_events SET payload = $1', ['{}'])).rejects.toMatchObject({ code: '42501' });
    } finally { await pool.end(); }
    await expect(supers.query("UPDATE erp.outbox_events SET payload = '{}'")).rejects.toMatchObject({ code: '55000' });
  });
  it('emits domain events from real operations', async () => {
    const res = await call(server, 'POST', '/v1/companies', { tenant, body: { legalName: 'Evented Co' } });
    const rows = await supers.query("SELECT event_type, payload FROM erp.outbox_events WHERE tenant_id = $1 AND aggregate_id = $2", [tenant, res.json.id]);
    expect(rows.rows).toEqual([{ event_type: 'company.created', payload: { id: res.json.id, legalName: 'Evented Co' } }]);
  });
});

describe('the background relay', () => {
  it('delivers events on its own schedule and stops cleanly at shutdown', async () => {
    const live = await startServer({ OUTBOX_RELAY_ENABLED: 'true', OUTBOX_POLL_INTERVAL_MS: '50' });
    try {
      const who = await createTenant(live, 'Relay Co');
      const got: string[] = [];
      live.app.get(OutboxRegistry).register({ name: 'live-consumer', eventTypes: ['live.thing_happened'], handle: async (event) => { got.push(event.id); } });
      const id = await live.app.get(UnitOfWork).inTenant(who, (tx) => live.app.get(OutboxService).publish(tx, who, { eventType: 'live.thing_happened', aggregateType: 'thing', aggregateId: 'x', payload: {} }));
      for (let i = 0; i < 60 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
      expect(got).toEqual([id]);
    } finally {
      await live.close(); // must not hang on the timer
    }
  });
});
