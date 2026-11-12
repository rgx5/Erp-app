import { readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const BOOTSTRAP_SQL = path.resolve(import.meta.dirname, '../../db/bootstrap/bootstrap.sql');

/**
 * Creates the migrator and application roles and the schema in ONE database. Run by a database administrator
 * (or the test harness), never by the application. Idempotent: running it again only resets the passwords.
 */
export async function bootstrapDatabase(adminDatabaseUrl: string, passwords: { migrator: string; app: string }): Promise<void> {
  const client = new pg.Client({ connectionString: adminDatabaseUrl });
  await client.connect();
  try {
    const sql = (await readFile(BOOTSTRAP_SQL, 'utf8'))
      .replaceAll(":'migrator_password'", client.escapeLiteral(passwords.migrator))
      .replaceAll(":'app_password'", client.escapeLiteral(passwords.app));
    await client.query(sql);
  } finally {
    await client.end();
  }
}
