import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PLATFORM_TOKEN, call, createTenant, makeGstin, startServer, testDb, uniqueSlug, type TestServer } from '../support/harness.js';

const ADAPTERS = ['fastify', 'node'] as const;

describe.each(ADAPTERS)('HTTP API on the %s adapter', (adapter) => {
  let server: TestServer;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    server = await startServer({ HTTP_ADAPTER: adapter });
    tenantA = await createTenant(server, 'Alpha Industries');
    tenantB = await createTenant(server, 'Bravo Industries');
  });
  afterAll(async () => { await server.close(); });

  describe('platform behaviour', () => {
    it('answers liveness and readiness', async () => {
      expect((await call(server, 'GET', '/health/live')).json).toEqual({ status: 'ok' });
      const ready = await call(server, 'GET', '/health/ready');
      expect(ready.status).toBe(200);
      expect(ready.json.status).toBe('ok');
      expect(ready.json.info.database.status).toBe('up');
    });

    it('sets a request id and security headers on success and on error', async () => {
      const ok = await call(server, 'GET', '/v1/tenant', { tenant: tenantA });
      expect(ok.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
      expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
      expect(ok.headers.get('x-frame-options')).toBe('DENY');
      expect(ok.headers.get('cache-control')).toBe('no-store');
      const bad = await call(server, 'GET', '/v1/tenant');
      expect(bad.headers.get('x-request-id')).toBeTruthy();
      expect(bad.headers.get('x-content-type-options')).toBe('nosniff');
    });

    it('echoes a well-formed X-Request-Id and ignores a malformed one', async () => {
      const good = await call(server, 'GET', '/health/live', { headers: { 'x-request-id': 'trace-abc-12345' } });
      expect(good.headers.get('x-request-id')).toBe('trace-abc-12345');
      const evil = await call(server, 'GET', '/health/live', { headers: { 'x-request-id': 'a b\tc<script>' } });
      expect(evil.headers.get('x-request-id')).not.toContain('<');
    });

    it('answers errors as RFC 9457 problem+json with the request id', async () => {
      const res = await call(server, 'GET', '/v1/nope', { tenant: tenantA });
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toContain('application/problem+json');
      expect(res.json).toMatchObject({ status: 404, title: 'Not found', code: 'not_found', type: 'urn:erp:error:not_found', instance: '/v1/nope' });
      expect(res.json.requestId).toBe(res.headers.get('x-request-id'));
    });

    it('rejects malformed JSON with a 400 problem and no internals', async () => {
      const res = await call(server, 'POST', '/v1/companies', { tenant: tenantA, headers: { 'content-type': 'application/json' }, rawBody: '{"legalName": ' });
      expect(res.status).toBe(400);
      expect(res.json.code).toBe('bad_request');
      expect(JSON.stringify(res.json)).not.toMatch(/at .*\.js|node_modules/);
    });

    it('rejects an oversized body', async () => {
      const res = await call(server, 'POST', '/v1/companies', { tenant: tenantA, body: { legalName: 'x'.repeat(1_200_000) } });
      expect(res.status).toBe(413);
      expect(res.json.code).toBe('payload_too_large');
    });

    it('serves the OpenAPI document describing the API', async () => {
      const res = await call(server, 'GET', '/openapi.json');
      expect(res.status).toBe(200);
      expect(Object.keys(res.json.paths)).toEqual(expect.arrayContaining(['/v1/companies', '/v1/companies/{id}', '/v1/warehouses', '/health/ready']));
      expect(res.json.paths['/v1/companies'].post.requestBody.content['application/json'].schema.properties.legalName).toBeTruthy();
    });
  });

  describe('tenant resolution (Slice 0, dev header)', () => {
    it('requires the tenant header', async () => {
      const res = await call(server, 'GET', '/v1/companies');
      expect(res.status).toBe(401);
      expect(res.json.code).toBe('unauthorized');
    });
    it('rejects a malformed tenant id', async () => {
      expect((await call(server, 'GET', '/v1/companies', { tenant: 'not-a-uuid' })).status).toBe(401);
    });
    it('treats an unknown tenant as empty rather than as an error', async () => {
      const res = await call(server, 'GET', '/v1/companies', { tenant: '01a1cf33-1a44-7104-863e-b26a759d6544' });
      expect(res.json.items).toEqual([]);
    });
  });

  describe('platform tenant provisioning', () => {
    it('needs the platform token', async () => {
      expect((await call(server, 'POST', '/v1/platform/tenants', { body: { name: 'X', slug: uniqueSlug() } })).status).toBe(403);
      expect((await call(server, 'POST', '/v1/platform/tenants', { token: 'wrong-token-wrong-token-wrong-token-1', body: { name: 'X', slug: uniqueSlug() } })).status).toBe(403);
    });
    it('is a 404 when no platform token is configured', async () => {
      const closed = await startServer({ HTTP_ADAPTER: adapter, PLATFORM_ADMIN_TOKEN: undefined });
      try {
        const res = await call(closed, 'POST', '/v1/platform/tenants', { token: PLATFORM_TOKEN, body: { name: 'X', slug: uniqueSlug() } });
        expect(res.status).toBe(404);
      } finally { await closed.close(); }
    });
    it('creates a tenant, rejects duplicate slugs, and validates input', async () => {
      const slug = uniqueSlug('dup');
      const first = await call(server, 'POST', '/v1/platform/tenants', { token: PLATFORM_TOKEN, body: { name: 'One', slug } });
      expect(first.status).toBe(201);
      expect(first.json).toMatchObject({ slug, name: 'One', status: 'active', version: 1 });
      const dup = await call(server, 'POST', '/v1/platform/tenants', { token: PLATFORM_TOKEN, body: { name: 'Two', slug } });
      expect(dup.status).toBe(409);
      expect(dup.json).toMatchObject({ code: 'conflict', constraint: 'tenants_slug_unique' });
      const bad = await call(server, 'POST', '/v1/platform/tenants', { token: PLATFORM_TOKEN, body: { name: '', slug: 'A' } });
      expect(bad.status).toBe(422);
      expect(bad.json.errors.map((e: { path: string }) => e.path).sort()).toEqual(['name', 'slug']);
    });
    it('returns the current tenant', async () => {
      const res = await call(server, 'GET', '/v1/tenant', { tenant: tenantA });
      expect(res.json).toMatchObject({ id: tenantA, name: 'Alpha Industries' });
    });
  });

  describe('the tenancy hierarchy', () => {
    const pan = 'ABCDE1234F';
    let companyId: string;
    let registrationId: string;
    let locationId: string;

    it('creates a company with defaults', async () => {
      const res = await call(server, 'POST', '/v1/companies', { tenant: tenantA, body: { legalName: 'Alpha Industries Pvt Ltd', pan } });
      expect(res.status).toBe(201);
      expect(res.json).toMatchObject({ legalName: 'Alpha Industries Pvt Ltd', pan, baseCurrency: 'INR', fiscalYearStartMonth: 4, status: 'active', version: 1 });
      companyId = res.json.id;
    });

    it('rejects an invalid company with every problem listed', async () => {
      const res = await call(server, 'POST', '/v1/companies', { tenant: tenantA, body: { legalName: ' ', pan: 'bad', baseCurrency: 'RUPEE', extra: 1 } });
      expect(res.status).toBe(422);
      expect(res.json.code).toBe('validation_failed');
      expect(res.json.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('supports several GST registrations (states) under one company', async () => {
      const mh = await call(server, 'POST', `/v1/companies/${companyId}/gst-registrations`, {
        tenant: tenantA, body: { gstin: makeGstin('27', pan), legalName: 'Alpha Industries Pvt Ltd', effectiveFrom: '2024-04-01' },
      });
      expect(mh.status).toBe(201);
      expect(mh.json).toMatchObject({ stateCode: '27', registrationType: 'regular', status: 'active', effectiveFrom: '2024-04-01', effectiveTo: null });
      registrationId = mh.json.id;
      const ka = await call(server, 'POST', `/v1/companies/${companyId}/gst-registrations`, {
        tenant: tenantA, body: { gstin: makeGstin('29', pan), legalName: 'Alpha Industries Pvt Ltd', effectiveFrom: '2024-06-01' },
      });
      expect(ka.status).toBe(201);
      const list = await call(server, 'GET', `/v1/companies/${companyId}/gst-registrations`, { tenant: tenantA });
      expect(list.json.items.map((r: { stateCode: string }) => r.stateCode)).toEqual(['27', '29']);
    });

    it('rejects a GSTIN with a bad check character, one of another PAN, and a duplicate', async () => {
      const post = (gstin: string) => call(server, 'POST', `/v1/companies/${companyId}/gst-registrations`, {
        tenant: tenantA, body: { gstin, legalName: 'X', effectiveFrom: '2024-04-01' },
      });
      const valid = makeGstin('27', pan);
      expect((await post(valid.slice(0, 14) + (valid.endsWith('A') ? 'B' : 'A'))).status).toBe(422);
      const otherPan = await post(makeGstin('27', 'ZZZZZ9999Z'));
      expect(otherPan.status).toBe(422);
      expect(otherPan.json).toMatchObject({ code: 'constraint_violated', constraint: 'gst_registrations_gstin_matches_company_pan' });
      const dup = await post(valid);
      expect(dup.status).toBe(409);
      expect(dup.json.constraint).toBe('gst_registrations_gstin_unique');
    });

    it('creates a principal business location and a warehouse for it', async () => {
      const loc = await call(server, 'POST', '/v1/business-locations', {
        tenant: tenantA,
        body: { companyId, gstRegistrationId: registrationId, code: 'PUNE', name: 'Pune plant', isPrincipalPlace: true, addressLine1: 'Plot 5, MIDC', city: 'Pune', stateCode: '27', pincode: '411019' },
      });
      expect(loc.status).toBe(201);
      expect(loc.json.address).toMatchObject({ line1: 'Plot 5, MIDC', stateCode: '27' });
      locationId = loc.json.id;
      const second = await call(server, 'POST', '/v1/business-locations', {
        tenant: tenantA,
        body: { companyId, gstRegistrationId: registrationId, code: 'PUNE2', name: 'Another', isPrincipalPlace: true, addressLine1: 'x', city: 'Pune', stateCode: '27', pincode: '411019' },
      });
      expect(second.status).toBe(409); // only one principal place per registration
      const wh = await call(server, 'POST', '/v1/warehouses', { tenant: tenantA, body: { businessLocationId: locationId, code: 'RM01', name: 'Raw material store', kind: 'raw_material' } });
      expect(wh.status).toBe(201);
      expect(wh.json.kind).toBe('raw_material');
      const bad = await call(server, 'POST', '/v1/warehouses', { tenant: tenantA, body: { businessLocationId: locationId, code: 'X', name: 'X', kind: 'nonsense' } });
      expect(bad.status).toBe(422);
    });

    it('lets a location be unregistered (no GST registration), but not principal', async () => {
      const ok = await call(server, 'POST', '/v1/business-locations', {
        tenant: tenantA, body: { companyId, code: 'GODOWN', name: 'Godown', addressLine1: 'x', city: 'Pune', stateCode: '27', pincode: '411019' },
      });
      expect(ok.status).toBe(201);
      expect(ok.json.gstRegistrationId).toBeNull();
    });

    it('reports a missing referenced record as 422, not 500', async () => {
      const res = await call(server, 'POST', '/v1/warehouses', { tenant: tenantA, body: { businessLocationId: '01a1cf33-1a44-7104-863e-b26a759d6544', code: 'X', name: 'X' } });
      expect(res.status).toBe(422);
      expect(res.json.code).toBe('reference_invalid');
    });

    it('updates a company only with the current version (optimistic locking)', async () => {
      const before = await call(server, 'GET', `/v1/companies/${companyId}`, { tenant: tenantA });
      const missing = await call(server, 'PATCH', `/v1/companies/${companyId}`, { tenant: tenantA, body: { tradeName: 'Alpha' } });
      expect(missing.status).toBe(428);
      const ok = await call(server, 'PATCH', `/v1/companies/${companyId}`, { tenant: tenantA, headers: { 'if-match': `"${before.json.version}"` }, body: { tradeName: 'Alpha' } });
      expect(ok.status).toBe(200);
      expect(ok.json).toMatchObject({ tradeName: 'Alpha', version: before.json.version + 1 });
      const stale = await call(server, 'PATCH', `/v1/companies/${companyId}`, { tenant: tenantA, headers: { 'if-match': String(before.json.version) }, body: { tradeName: 'Stale' } });
      expect(stale.status).toBe(412);
      expect(stale.json.code).toBe('precondition_failed');
      const gone = await call(server, 'PATCH', '/v1/companies/01a1cf33-1a44-7104-863e-b26a759d6544', { tenant: tenantA, headers: { 'if-match': '1' }, body: { tradeName: 'x' } });
      expect(gone.status).toBe(404);
    });

    it('paginates with a stable cursor', async () => {
      const t = await createTenant(server, 'Pager');
      for (let i = 0; i < 5; i++) await call(server, 'POST', '/v1/companies', { tenant: t, body: { legalName: `Co ${i}` } });
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: { json: { items: { legalName: string }[]; nextCursor: string | null } } = await call(server, 'GET', `/v1/companies?limit=2${cursor ? `&cursor=${cursor}` : ''}`, { tenant: t });
        seen.push(...res.json.items.map((c) => c.legalName));
        cursor = res.json.nextCursor;
        pages++;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual(['Co 0', 'Co 1', 'Co 2', 'Co 3', 'Co 4']);
      expect((await call(server, 'GET', '/v1/companies?cursor=garbage', { tenant: t })).status).toBe(422);
      expect((await call(server, 'GET', '/v1/companies?limit=0', { tenant: t })).status).toBe(422);
    });
  });

  describe('tenant isolation through the API', () => {
    it('hides one tenant\'s data from another and answers 404, never 403', async () => {
      const company = await call(server, 'POST', '/v1/companies', { tenant: tenantA, body: { legalName: 'Secret Co' } });
      const asB = await call(server, 'GET', `/v1/companies/${company.json.id}`, { tenant: tenantB });
      expect(asB.status).toBe(404);
      const listB = await call(server, 'GET', '/v1/companies', { tenant: tenantB });
      expect(listB.json.items.map((c: { legalName: string }) => c.legalName)).not.toContain('Secret Co');
      const patchB = await call(server, 'PATCH', `/v1/companies/${company.json.id}`, { tenant: tenantB, headers: { 'if-match': '1' }, body: { legalName: 'pwned' } });
      expect(patchB.status).toBe(404);
      expect((await call(server, 'GET', `/v1/companies/${company.json.id}`, { tenant: tenantA })).json.legalName).toBe('Secret Co');
    });

    it('cannot attach a child to another tenant\'s parent (answers as if it does not exist)', async () => {
      const company = await call(server, 'POST', '/v1/companies', { tenant: tenantA, body: { legalName: 'Parent Co' } });
      const res = await call(server, 'POST', '/v1/business-locations', {
        tenant: tenantB, body: { companyId: company.json.id, code: 'X', name: 'X', addressLine1: 'x', city: 'x', stateCode: '27', pincode: '411001' },
      });
      expect(res.status).toBe(422);
      expect(res.json.code).toBe('reference_invalid');
      const reg = await call(server, 'POST', `/v1/companies/${company.json.id}/gst-registrations`, {
        tenant: tenantB, body: { gstin: makeGstin('27', 'ABCDE1234F'), legalName: 'x', effectiveFrom: '2024-04-01' },
      });
      expect(reg.status).toBe(422);
    });

    it('cannot smuggle a tenant id in the body', async () => {
      const res = await call(server, 'POST', '/v1/companies', { tenant: tenantB, body: { legalName: 'Sneaky', tenantId: tenantA } });
      expect(res.status).toBe(422);
    });
  });
});

describe('startup safety', () => {
  it('refuses to start when pointed at the table-owner role', async () => {
    await expect(startServer({ DATABASE_URL: testDb().migratorUrl })).rejects.toThrow(/Refusing to start: database role "erp_migrator"/);
  });
  it('refuses to start as a superuser', async () => {
    const url = new URL(testDb().adminUrl);
    url.pathname = `/${testDb().dbName}`;
    await expect(startServer({ DATABASE_URL: url.toString() })).rejects.toThrow(/Refusing to start/);
  });
  it('readiness fails (503) when the database is behind the build\'s migrations', async () => {
    const admin = new pg.Client({ connectionString: testDb().migratorUrl });
    await admin.connect();
    const server = await startServer();
    try {
      await admin.query("UPDATE erp.schema_migrations SET id = '0000_old' WHERE id = (SELECT max(id) FROM erp.schema_migrations)");
      const res = await call(server, 'GET', '/health/ready');
      expect(res.status).toBe(503);
      await admin.query("UPDATE erp.schema_migrations SET id = '0002_tenancy.sql' WHERE id = '0000_old'");
    } finally {
      await server.close();
      await admin.end();
    }
  });
});
