import { generateKeyPairSync } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool, migrate } from '../src/db.js';

const ADMIN_URL = process.env['TEST_PG_ADMIN_URL'] ?? 'postgres://postgres@localhost:5434/postgres';
const pem = (): string => generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

export async function testApp() {
  const name = `cp_test_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  const config = loadConfig({ DATABASE_URL: url, LICENCE_PRIVATE_KEY: pem(), RELEASE_PRIVATE_KEY: pem(), NODE_ENV: 'test', SILENT_AFTER_MINUTES: '10' } as NodeJS.ProcessEnv);
  const pool = createPool(url);
  await migrate(pool);
  const app = buildApp({ pool, config });
  await app.ready();

  const staff = async (role: 'admin' | 'support' | 'viewer', password = 'a-long-staff-password-1') => {
    const email = `${role}-${Math.floor(Math.random() * 1e9)}@example.com`;
    await pool.query('INSERT INTO staff_users (id, email, display_name, password_hash, role) VALUES (gen_random_uuid(), $1, $2, $3, $4)', [email, `Test ${role}`, await hash(password), role]);
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    return { email, password, token: r.json().token as string };
  };
  const call = async (method: string, url: string, token: string | null, payload?: unknown) => {
    const r = await app.inject({ method: method as 'GET', url, ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}), ...(payload !== undefined ? { payload: payload as object } : {}) });
    return { status: r.statusCode, json: r.body ? (JSON.parse(r.body) as Record<string, any>) : {} }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  return { app, pool, config, staff, call, async close() { await app.close(); await pool.end(); await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.end(); } };
}
