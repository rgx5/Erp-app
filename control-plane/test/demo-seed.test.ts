import { describe, expect, it } from 'vitest';
import { ensureFirstAdmin } from '../src/first-admin.js';
import { testApp } from './support.js';

describe('first admin from settings', () => {
  it('is created once, only when there is no staff, and can sign in', async () => {
    const t = await testApp({ BOOTSTRAP_ADMIN_EMAIL: 'Boss@Example.com', BOOTSTRAP_ADMIN_PASSWORD: 'a-long-first-password', BOOTSTRAP_ADMIN_NAME: 'The Boss', REQUIRE_STAFF_MFA: 'false' });
    try {
      expect(await ensureFirstAdmin(t.pool, t.config)).toBe('boss@example.com');
      expect(await ensureFirstAdmin(t.pool, t.config)).toBeNull(); // already has staff: nothing more
      const login = await t.call('POST', '/auth/login', null, { email: 'boss@example.com', password: 'a-long-first-password' });
      expect(login.status).toBe(200); expect(login.json.staff).toMatchObject({ role: 'admin', displayName: 'The Boss' });
      const bare = await testApp(); // not configured: nothing is created
      try { expect(await ensureFirstAdmin(bare.pool, bare.config)).toBeNull(); } finally { await bare.close(); }
    } finally { await t.close(); }
  });
});

describe('POST /demo/seed', () => {
  it('is off (404) unless enabled, admin only, and fills an empty control panel once', async () => {
    const off = await testApp(); const on = await testApp({ DEMO_SEED_ENABLED: 'true', REQUIRE_STAFF_MFA: 'false' });
    try {
      const offAdmin = await off.staff('admin');
      expect((await off.call('POST', '/demo/seed', offAdmin.token, {})).status).toBe(404);
      expect((await off.call('GET', '/me', offAdmin.token)).json.demoSeed).toBe(false);
      const admin = await on.staff('admin'); const viewer = await on.staff('viewer');
      expect((await on.call('GET', '/me', admin.token)).json.demoSeed).toBe(true);
      expect((await on.call('POST', '/demo/seed', viewer.token, {})).status).toBe(403);
      await on.app.listen({ port: 0, host: '127.0.0.1' });
      const base = `http://127.0.0.1:${(on.app.server.address() as { port: number }).port}`;
      const post = () => fetch(`${base}/demo/seed`, { method: 'POST', headers: { authorization: `Bearer ${admin.token}`, 'content-type': 'application/json' }, body: '{}' });
      const first = await post(); expect(first.status).toBe(200);
      const overview = (await on.call('GET', '/overview', admin.token)).json;
      expect(overview.cells.total).toBe(8); expect(overview.tenants.total).toBe(9); expect(overview.alerts.critical).toBeGreaterThan(0);
      expect((await post()).status).toBe(200); // again: nothing duplicated
      expect((await on.call('GET', '/overview', admin.token)).json.cells.total).toBe(8);
    } finally { await off.close(); await on.close(); }
  }, 60_000);
});
