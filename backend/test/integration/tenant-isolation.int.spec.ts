import pg from 'pg';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/platform/database/database.js';
import { inspectRuntimeRole } from '../../src/platform/database/runtime-role.js';
import { businessLocations, companies, gstRegistrations, tenants, warehouses } from '../../src/db/schema.js';
import { appPool, makeGstin, testDb, unitOfWork } from '../support/harness.js';
import { urlFor } from '../support/urls.js';

let pool: pg.Pool;
let owner: pg.Pool;
let uow: ReturnType<typeof unitOfWork>;

interface Seed { tenantId: string; companyId: string; registrationId: string; locationId: string; warehouseId: string }

async function seedTenant(name: string, pan: string): Promise<Seed> {
  const tenantId = uuidv7();
  const companyId = uuidv7();
  const registrationId = uuidv7();
  const locationId = uuidv7();
  const warehouseId = uuidv7();
  await uow.inTenant(tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, slug: `iso-${tenantId.slice(-12)}`, name });
    await tx.insert(companies).values({ tenantId, id: companyId, legalName: `${name} Ltd`, pan });
    await tx.insert(gstRegistrations).values({
      tenantId, id: registrationId, companyId, gstin: makeGstin('27', pan), stateCode: '27', legalName: `${name} Ltd`, effectiveFrom: '2024-04-01',
    });
    await tx.insert(businessLocations).values({
      tenantId, id: locationId, companyId, gstRegistrationId: registrationId, code: 'HO', name: 'Head office',
      isPrincipalPlace: true, addressLine1: '1 Main Rd', city: 'Pune', stateCode: '27', pincode: '411001',
    });
    await tx.insert(warehouses).values({ tenantId, id: warehouseId, businessLocationId: locationId, code: 'RM', name: 'Raw material', kind: 'raw_material' });
  });
  return { tenantId, companyId, registrationId, locationId, warehouseId };
}

const code = (error: unknown): string | undefined => {
  for (let e: unknown = error, i = 0; e instanceof Error && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && c.length === 5) return c;
  }
  return undefined;
};

beforeAll(() => {
  pool = appPool(2); // two connections: every test below reuses them across tenants
  uow = unitOfWork(pool);
  owner = new pg.Pool({ connectionString: testDb().migratorUrl, max: 1 });
});
afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('the runtime database role', () => {
  it('is not a superuser, has no BYPASSRLS, owns nothing and cannot create objects', async () => {
    const report = await inspectRuntimeRole(pool);
    expect(report.role).toBe('erp_app');
    expect(report.problems).toEqual([]);
  });

  it('cannot create tables, delete rows, or write the migration table', async () => {
    const { tenantId } = await seedTenant('Privs', 'PRVSA1234A');
    await expect(pool.query('CREATE TABLE erp.sneaky (id int)')).rejects.toMatchObject({ code: '42501' });
    await expect(uow.inTenant(tenantId, (tx) => tx.execute(sql`delete from erp.companies`))).rejects.toSatisfy((e) => code(e) === '42501');
    await expect(pool.query("INSERT INTO erp.schema_migrations (id, checksum, duration_ms) VALUES ('x','y',1)")).rejects.toMatchObject({ code: '42501' });
  });

  it('owns no table: every table in the schema belongs to the migrator', async () => {
    const { rows } = await owner.query<{ owner: string }>("SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'erp' AND c.relkind = 'r'");
    expect(rows.map((r) => r.owner)).toEqual(['erp_migrator']);
  });
});

describe('row-level security configuration', () => {
  it('is enabled, forced and backed by a policy on EVERY table in the schema (so a future table cannot forget it)', async () => {
    const { rows } = await owner.query<{ table: string; rls: boolean; forced: boolean; policies: number }>(`
      SELECT c.relname AS "table", c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'erp' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'`);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) expect(row, row.table).toMatchObject({ rls: true, forced: true, policies: expect.any(Number) });
    for (const row of rows) expect(row.policies, row.table).toBeGreaterThan(0);
  });

  it('puts tenant_id in the primary key of every tenant-owned table, and every foreign key includes it', async () => {
    const tables = await owner.query<{ table: string; pk: string[] }>(`
      SELECT c.relname AS "table", array_agg(a.attname::text ORDER BY k.ord) AS pk
        FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
       WHERE n.nspname = 'erp' AND con.contype = 'p' AND c.relname NOT IN ('tenants', 'schema_migrations') GROUP BY c.relname`);
    for (const t of tables.rows) expect(t.pk[0], t.table).toBe('tenant_id');
    const fks = await owner.query<{ table: string; ref: string; cols: string[] }>(`
      SELECT c.relname AS "table", r.relname AS ref, array_agg(a.attname::text) AS cols
        FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_class r ON r.oid = con.confrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL unnest(con.conkey) AS k(attnum) JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
       WHERE n.nspname = 'erp' AND con.contype = 'f' GROUP BY con.oid, c.relname, r.relname`);
    for (const fk of fks.rows.filter((f) => f.ref !== 'tenants')) expect(fk.cols, `${fk.table} -> ${fk.ref}`).toContain('tenant_id');
  });
});

describe('tenant isolation through the real application role and a tiny shared pool', () => {
  it('shows each tenant only its own rows in every table', async () => {
    const a = await seedTenant('Alpha', 'ALPHA1234A');
    const b = await seedTenant('Bravo', 'BRAVO1234B');
    for (const [seed, other] of [[a, b], [b, a]] as const) {
      await uow.inTenant(seed.tenantId, async (tx) => {
        const db = tx;
        expect((await db.select().from(tenants)).map((r) => r.id)).toEqual([seed.tenantId]);
        expect((await db.select().from(companies)).map((r) => r.id)).toEqual([seed.companyId]);
        expect((await db.select().from(gstRegistrations)).map((r) => r.id)).toEqual([seed.registrationId]);
        expect((await db.select().from(businessLocations)).map((r) => r.id)).toEqual([seed.locationId]);
        expect((await db.select().from(warehouses)).map((r) => r.id)).toEqual([seed.warehouseId]);
        // Even asking for the other tenant's rows by id (and by tenant_id) returns nothing.
        expect(await db.execute(sql`select 1 from erp.companies where id = ${other.companyId}`)).toHaveProperty('rowCount', 0);
        expect(await db.execute(sql`select 1 from erp.companies where tenant_id = ${other.tenantId}`)).toHaveProperty('rowCount', 0);
      });
    }
  });

  it('fails closed: with no tenant set, every table is empty and every write is refused', async () => {
    await seedTenant('Closed', 'CLOSD1234C');
    for (const table of ['tenants', 'companies', 'gst_registrations', 'business_locations', 'warehouses']) {
      const result = await pool.query(`SELECT 1 FROM erp.${table}`);
      expect(result.rowCount, table).toBe(0);
    }
    await expect(pool.query("INSERT INTO erp.tenants (id, slug, name) VALUES ($1, 'no-context', 'x')", [uuidv7()])).rejects.toMatchObject({ code: '42501' });
  });

  it('refuses to write a row for another tenant, and cannot touch another tenant\'s rows', async () => {
    const a = await seedTenant('Writer', 'WRITR1234W');
    const b = await seedTenant('Victim', 'VICTM1234V');
    await expect(
      uow.inTenant(a.tenantId, (tx) => tx.insert(companies).values({ tenantId: b.tenantId, id: uuidv7(), legalName: 'Forged' })),
    ).rejects.toSatisfy((e) => code(e) === '42501');
    const update = await uow.inTenant(a.tenantId, (tx) => tx.execute(sql`update erp.companies set legal_name = 'pwned' where id = ${b.companyId}`));
    expect(update.rowCount).toBe(0);
    const del = await owner.query('SELECT legal_name FROM erp.companies WHERE tenant_id = $1', [b.tenantId]);
    // The migrator is also subject to FORCE ROW LEVEL SECURITY, so even the owner sees nothing without a tenant context.
    expect(del.rowCount).toBe(0);
    const reread = await uow.inTenant(b.tenantId, (tx) => tx.select().from(companies));
    expect(reread[0]?.legalName).toBe('Victim Ltd');
  });

  it('cannot reference another tenant\'s row: composite foreign keys bind children to the same tenant', async () => {
    const a = await seedTenant('FkA', 'FKAAA1234A');
    const b = await seedTenant('FkB', 'FKBBB1234B');
    // Tenant A names tenant B's company: A cannot SEE it, yet the foreign key must still refuse (RI checks bypass RLS).
    await expect(
      uow.inTenant(a.tenantId, (tx) =>
        tx.insert(businessLocations).values({ tenantId: a.tenantId, id: uuidv7(), companyId: b.companyId, code: 'X', name: 'X', addressLine1: 'x', city: 'x', stateCode: '27', pincode: '411001' }),
      ),
    ).rejects.toSatisfy((e) => code(e) === '23503');
    await expect(
      uow.inTenant(a.tenantId, (tx) =>
        tx.insert(warehouses).values({ tenantId: a.tenantId, id: uuidv7(), businessLocationId: b.locationId, code: 'X', name: 'X' }),
      ),
    ).rejects.toSatisfy((e) => code(e) === '23503');
  });

  it('keeps a location, its GST registration and its company consistent inside one tenant', async () => {
    const a = await seedTenant('Same', 'SAMEA1234A');
    const second = uuidv7();
    await uow.inTenant(a.tenantId, (tx) => tx.insert(companies).values({ tenantId: a.tenantId, id: second, legalName: 'Second Ltd', pan: 'SECND1234S' }));
    // A location of the second company may not use the first company's GST registration.
    await expect(
      uow.inTenant(a.tenantId, (tx) =>
        tx.insert(businessLocations).values({ tenantId: a.tenantId, id: uuidv7(), companyId: second, gstRegistrationId: a.registrationId, code: 'Y', name: 'Y', addressLine1: 'y', city: 'y', stateCode: '27', pincode: '411001' }),
      ),
    ).rejects.toSatisfy((e) => code(e) === '23503');
  });

  it('never carries a tenant from one request to the next on a pooled connection', async () => {
    const tenantsSeeded = await Promise.all(['P1', 'P2', 'P3', 'P4'].map((n, i) => seedTenant(`Pool${n}`, `${'ABCD'[i]!.repeat(5)}1234P`)));
    const leaks: string[] = [];
    // 120 concurrent transactions over 2 connections, alternating tenants, some of which fail midway.
    await Promise.all(
      Array.from({ length: 120 }, async (_, i) => {
        const seed = tenantsSeeded[i % tenantsSeeded.length]!;
        try {
          await uow.inTenant(seed.tenantId, async (tx) => {
            await tx.execute(sql`select pg_sleep(0.002)`);
            const rows = await tx.select().from(companies);
            if (rows.length !== 1 || rows[0]?.id !== seed.companyId) leaks.push(`tx ${i}: saw ${rows.map((r) => r.id).join(',')}`);
            if (i % 7 === 0) throw new Error('simulated failure');
          });
        } catch (error) {
          if ((error as Error).message !== 'simulated failure') throw error;
        }
      }),
    );
    expect(leaks).toEqual([]);
    // Whatever connection the pool hands out next carries NO tenant, after commits and after rollbacks alike.
    for (let i = 0; i < 10; i++) {
      const { rows } = await pool.query("SELECT current_setting('app.tenant_id', true) AS t");
      expect(rows[0].t === null || rows[0].t === '').toBe(true);
      expect((await pool.query('SELECT 1 FROM erp.companies')).rowCount).toBe(0);
    }
  });

  it('rejects a tenant id that is not a UUID before it reaches the database', async () => {
    await expect(uow.inTenant("x'; drop table erp.companies; --", async () => 1)).rejects.toThrow(TypeError);
  });
});

describe('the application refuses to run with an unsafe database role', () => {
  it('is detected for the table owner role', async () => {
    const ownerPool = new pg.Pool({ connectionString: testDb().migratorUrl, max: 1 });
    const report = await inspectRuntimeRole(ownerPool);
    await ownerPool.end();
    expect(report.problems.join(' ')).toMatch(/owns, or can act as the owner/);
    expect(report.problems.join(' ')).toMatch(/can create objects/);
  });

  it('is detected for a superuser', async () => {
    const superPool = new pg.Pool({ connectionString: urlFor(testDb().adminUrl, undefined, undefined, testDb().dbName), max: 1 });
    const report = await inspectRuntimeRole(superPool);
    await superPool.end();
    expect(report.superuser).toBe(true);
    expect(report.bypassRls).toBe(true);
    expect(report.problems.length).toBeGreaterThanOrEqual(2);
  });
});

void createDb;
