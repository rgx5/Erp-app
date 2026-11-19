import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EDITIONS, editionProblems } from '../src/plans.js';
import { testApp } from './support.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('editions', () => {
  it('are valid licences, each containing the one below, and run from small shop to manufacturer', () => {
    expect(editionProblems()).toEqual([]);
    expect(EDITIONS.map((e) => e.id)).toEqual(['starter', 'growth', 'enterprise', 'manufacturing']);
    const starter = EDITIONS[0]!;
    expect(starter.modules).toEqual(['sales', 'inventory', 'pos']);
    expect(starter.modules).not.toContain('accounting'); // the books run underneath; the screens are not licensed
    expect(EDITIONS[3]!.modules).toContain('manufacturing'); expect(EDITIONS[2]!.modules).not.toContain('manufacturing');
  });
  it('are listed for staff, and an edition issues as a real licence', async () => {
    const admin = await t.staff('admin');
    const list = (await t.call('GET', '/plans', admin.token)).json.items as { id: string; plan: string; modules: string[]; limits: Record<string, number> }[];
    expect(list).toHaveLength(4);
    const client = (await t.call('POST', '/clients', admin.token, { name: 'Corner Shop', tier: 'cloud' })).json;
    const site = (await t.call('POST', '/sites', admin.token, { clientId: client.id, code: 'POOL-P', name: 'pool', kind: 'pooled', tenantId: '01a1ef97-0000-7000-8000-000000000501' })).json;
    const starter = list.find((e) => e.id === 'starter')!;
    const r = await t.call('POST', `/sites/${site.id}/licences`, admin.token, { plan: starter.plan, modules: starter.modules, limits: starter.limits });
    expect(r.status).toBe(201); expect(r.json.licence.plan).toBe('Starter'); expect([...r.json.licence.modules].sort()).toEqual(['inventory', 'pos', 'sales']); expect(r.json.licence.limits).toMatchObject({ users: 3, terminals: 2 });
  });
});
