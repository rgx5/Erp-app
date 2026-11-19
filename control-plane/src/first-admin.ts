import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import type { Config } from './config.js';
import type { Db } from './db.js';

/** Creates the first admin from BOOTSTRAP_ADMIN_* when the control plane has no staff at all. Does nothing otherwise, so it can stay configured. */
export async function ensureFirstAdmin(pool: Db, config: Config): Promise<string | null> {
  if (!config.BOOTSTRAP_ADMIN_EMAIL || !config.BOOTSTRAP_ADMIN_PASSWORD) return null;
  const n = Number((await pool.query<{ n: string }>('SELECT count(*)::text AS n FROM staff_users')).rows[0]?.n ?? 0);
  if (n > 0) return null;
  await pool.query('INSERT INTO staff_users (id, email, display_name, password_hash, role) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase(), config.BOOTSTRAP_ADMIN_NAME, await hash(config.BOOTSTRAP_ADMIN_PASSWORD), 'admin']);
  return config.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
}
