import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '../../src/db/bootstrap.js';
import * as schema from '../../src/db/schema.js';
import { MIGRATIONS_DIR, MigrationError, migrateUp, migrationStatus } from '../../src/db/migrator.js';
import { PASSWORDS, urlFor } from '../support/urls.js';
import { testDb } from '../support/harness.js';

const scratch: string[] = [];
afterAll(async () => {
  const admin = new pg.Client({ connectionString: testDb().adminUrl });
  await admin.connect();
  for (const name of scratch) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

/** A throwaway, bootstrapped (but unmigrated) database, so migration behaviour can be tested destructively. */
async function freshDatabase(): Promise<string> {
  const name = `erp_mig_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  scratch.push(name);
  const admin = new pg.Client({ connectionString: testDb().adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  await bootstrapDatabase(urlFor(testDb().adminUrl, undefined, undefined, name), PASSWORDS);
  return urlFor(testDb().adminUrl, 'erp_migrator', PASSWORDS.migrator, name);
}

describe('migrations', () => {
  it('apply once and are a no-op the second time', async () => {
    const url = await freshDatabase();
    const first = await migrateUp(url);
    expect(first.applied.length).toBeGreaterThan(0);
    const second = await migrateUp(url);
    expect(second.applied).toEqual([]);
    expect((await migrationStatus(url)).pending).toEqual([]);
  });

  it('refuse to continue when an applied migration file was edited', async () => {
    const url = await freshDatabase();
    const dir = await mkdtemp(path.join(tmpdir(), 'erp-mig-'));
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await migrateUp(url, dir);
    const file = path.join(dir, '0001_foundation.sql');
    await writeFile(file, (await readFile(file, 'utf8')) + '\n-- tampered\n');
    await expect(migrateUp(url, dir)).rejects.toThrow(/modified after it ran/);
  });

  it('refuse to continue when an applied migration file is missing', async () => {
    const url = await freshDatabase();
    const dir = await mkdtemp(path.join(tmpdir(), 'erp-mig-'));
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await migrateUp(url, dir);
    await (await import('node:fs/promises')).rm(path.join(dir, '0002_tenancy.sql'));
    await expect(migrateUp(url, dir)).rejects.toBeInstanceOf(MigrationError);
  });

  it('roll a failing migration back completely and leave the schema untouched', async () => {
    const url = await freshDatabase();
    const dir = await mkdtemp(path.join(tmpdir(), 'erp-mig-'));
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await migrateUp(url, dir);
    await writeFile(path.join(dir, '0003_broken.sql'), 'CREATE TABLE erp.half_done (id int); SELECT 1/0;');
    await expect(migrateUp(url, dir)).rejects.toThrow(/0003_broken\.sql failed and was rolled back/);
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    expect((await client.query("SELECT to_regclass('erp.half_done') AS t")).rows[0].t).toBeNull();
    await client.end();
  });

  it('refuse a new migration that sorts before one already applied', async () => {
    const url = await freshDatabase();
    const dir = await mkdtemp(path.join(tmpdir(), 'erp-mig-'));
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    await migrateUp(url, dir);
    await writeFile(path.join(dir, '0001_aaa_late.sql'), 'SELECT 1;');
    await expect(migrateUp(url, dir)).rejects.toThrow(/sorts before/);
  });
});

describe('drizzle schema', () => {
  it('matches the real database columns, so the ORM and the SQL cannot drift apart', async () => {
    const client = new pg.Client({ connectionString: testDb().migratorUrl });
    await client.connect();
    let checked = 0;
    for (const table of Object.values(schema)) {
      if (!is(table, PgTable)) continue;
      checked++;
      const name = getTableName(table);
      const declared = Object.values(getTableColumns(table)).map((c) => c.name).sort((a, b) => a.localeCompare(b));
      const { rows } = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'erp' AND table_name = $1 ORDER BY column_name",
        [name],
      );
      expect(declared, `columns of erp.${name}`).toEqual(rows.map((r) => r.column_name));
    }
    expect(checked).toBe(5);
    await client.end();
  });
});
