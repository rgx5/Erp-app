import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { bootstrapDatabase } from '../../src/db/bootstrap.js';
import { migrateUp } from '../../src/db/migrator.js';
import { PASSWORDS, urlFor } from './urls.js';

export interface TestDb {
  /** Server-level admin connection (a superuser): used only to create and drop databases. */
  adminUrl: string;
  dbName: string;
  appUrl: string;
  migratorUrl: string;
}
declare module 'vitest' {
  interface ProvidedContext {
    testDb: TestDb;
  }
}

const ADMIN_URL = process.env['TEST_PG_ADMIN_URL'] ?? 'postgresql://postgres@localhost:5434/postgres';

/** One fresh database per run: roles and schema bootstrapped as an admin, migrations applied as the owner role. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const dbName = `erp_test_${process.pid}_${Date.now().toString(36)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const dbAdminUrl = urlFor(ADMIN_URL, undefined, undefined, dbName);
  await bootstrapDatabase(dbAdminUrl, PASSWORDS);
  const migratorUrl = urlFor(ADMIN_URL, 'erp_migrator', PASSWORDS.migrator, dbName);
  await migrateUp(migratorUrl);
  project.provide('testDb', { adminUrl: ADMIN_URL, dbName, migratorUrl, appUrl: urlFor(ADMIN_URL, 'erp_app', PASSWORDS.app, dbName) });
  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.end();
  };
}
