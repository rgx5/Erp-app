import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { bootstrapDatabase } from '../../src/db/bootstrap.js';
import { migrateUp } from '../../src/db/migrator.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportTenant, importTenant, verifyTenantExport } from '../../src/maintenance/tenant-move.js';
import { call, createRegistration, createTenantWithOwner, OWNER_PASSWORD, startServer, testDb, type TestServer } from '../support/harness.js';
import { ok } from '../support/shop.js';
import { PASSWORDS, urlFor } from '../support/urls.js';

let source: TestServer;
let target: TestServer | undefined;
const targetName = `erp_move_${process.pid}`;
const admin = new pg.Client({ connectionString: testDb().adminUrl });
// moving a client needs the database administrator connection: the table owner is itself held back by row-level security, and only an administrator may switch triggers off
const srcMigrator = new pg.Pool({ connectionString: urlFor(testDb().adminUrl, undefined, undefined, testDb().dbName), max: 2 });
let dstMigrator: pg.Pool;
beforeAll(async () => {
  source = await startServer();
  await admin.connect();
  await admin.query(`CREATE DATABASE ${targetName}`);
  await bootstrapDatabase(urlFor(testDb().adminUrl, undefined, undefined, targetName), PASSWORDS);
  await migrateUp(urlFor(testDb().adminUrl, 'erp_migrator', PASSWORDS.migrator, targetName));
  srcMigrator.on('error', () => undefined);
  dstMigrator = new pg.Pool({ connectionString: urlFor(testDb().adminUrl, undefined, undefined, targetName), max: 2 });
  dstMigrator.on('error', () => undefined);
  target = await startServer({ DATABASE_URL: urlFor(testDb().adminUrl, 'erp_app', PASSWORDS.app, targetName) });
});
afterAll(async () => { await target?.close(); await source.close(); await srcMigrator.end(); await dstMigrator.end(); await admin.query(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`); await admin.end(); });

describe('moving a client between cells', () => {
  it('copies everything, including attachments and passwords, verifies it, refuses a second move, and the client signs in on the new cell', async () => {
    const t = await createTenantWithOwner(source, 'Mover Co');
    const { companyId } = await createRegistration(source, t.id);
    ok(await call(source, 'POST', `/v1/companies/${companyId}/chart-of-accounts/template`, { tenant: t.id, body: { template: 'manufacturing_india' } }));
    const accounts = (await call(source, 'GET', `/v1/accounts?companyId=${companyId}&limit=200`, { tenant: t.id })).json.items as { id: string; code: string }[];
    const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id]));
    ok(await call(source, 'POST', '/v1/fiscal-years', { tenant: t.id, body: { companyId, startDate: '2025-04-01' } }));
    ok(await call(source, 'POST', '/v1/journal-entries', { tenant: t.id, body: { companyId, postingDate: '2025-04-10', description: 'seed', lines: [{ accountId: acc['1120'], debit: '500.00' }, { accountId: acc['4100'], credit: '500.00' }] } }));
    const party = ok(await call(source, 'POST', '/v1/parties', { tenant: t.id, body: { code: 'MV1', legalName: 'Mover Customer', isCustomer: true, gstTreatment: 'consumer' } }));
    const pdf = Buffer.from('%PDF-1.4 move test document');
    const att = ok(await call(source, 'POST', '/v1/attachments', { tenant: t.id, body: { entityType: 'party', entityId: party.id, kind: 'file', filename: 'agreement.pdf', contentType: 'application/pdf', dataBase64: pdf.toString('base64') } }));

    const dir = mkdtempSync(join(tmpdir(), 'move-'));
    const m = await exportTenant(srcMigrator, t.id, dir);
    expect(m.tables['journal_lines']?.rows).toBeGreaterThan(0);
    expect(m.tables['attachments']?.rows).toBe(1);
    expect((await verifyTenantExport(dir)).tenantId).toBe(t.id);

    // a damaged folder is refused before anything is touched
    const file = join(dir, 'parties.ndjson');
    const original = readFileSync(file, 'utf8');
    writeFileSync(file, original.replace('Mover Customer', 'Changed Customer'));
    await expect(verifyTenantExport(dir)).rejects.toThrow(/changed or damaged/);
    writeFileSync(file, original);

    const dry = await importTenant(dstMigrator, dir, { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect((await dstMigrator.query('SELECT count(*)::int AS n FROM erp.tenants WHERE id = $1', [t.id])).rows[0].n).toBe(0); // the rehearsal changed nothing

    const done = await importTenant(dstMigrator, dir);
    expect(done.rows).toBeGreaterThan(10);
    await expect(importTenant(dstMigrator, dir)).rejects.toThrow(/already exists/);

    // everything is the same on the other side, counted table by table
    for (const [table, info] of Object.entries(m.tables)) {
      const key = table === 'tenants' ? 'id' : 'tenant_id';
      expect(Number((await dstMigrator.query(`SELECT count(*)::int AS n FROM erp."${table}" WHERE ${key} = $1`, [t.id])).rows[0].n), table).toBe(info.rows);
    }
    const bytes = (await dstMigrator.query('SELECT data FROM erp.attachments WHERE id = $1', [att.id])).rows[0].data as Buffer;
    expect(bytes.equals(pdf)).toBe(true);

    // the owner signs in on the new cell with the same password, and sees the same books
    const login = await call(target as TestServer, 'POST', '/v1/auth/login', { body: { tenant: t.slug, email: t.ownerEmail, password: OWNER_PASSWORD } });
    expect(login.status).toBe(200);
    const tb = await call(target as TestServer, 'GET', `/v1/accounting/trial-balance?companyId=${companyId}&from=2025-04-01&to=2026-03-31`, { token: login.json.accessToken });
    expect(tb.status).toBe(200);
    const accounts2 = await call(target as TestServer, 'GET', `/v1/accounts?companyId=${companyId}&limit=200`, { token: login.json.accessToken });
    expect(accounts2.json.items).toHaveLength(accounts.length);
  });
});
