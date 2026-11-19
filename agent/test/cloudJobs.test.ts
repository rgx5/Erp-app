import { describe, expect, it } from 'vitest';
import { expireAll, restoreTests, sampleFor, verifyAll, type CloudClient } from '../src/backup/cloudJobs.js';
import type { Runner } from '../src/backup/pgbackrest.js';
import type { ScratchPorts } from '../src/backup/restoreTest.js';

const client = (site: string, repoCount = 2): CloudClient => ({ site, stanza: 'onesync', configFile: `/c/${site}.conf`, repoCount, cipherPass: async () => `key-of-${site}` });
const runner = (fail: (cmd: string[], env: Record<string, string>) => string | null, out = (_a: string[]) => 'INFO: verify command end: completed successfully'): Runner & { seen: { args: string[]; env: Record<string, string> }[] } => {
  const seen: { args: string[]; env: Record<string, string> }[] = [];
  return { seen, run: async (_c, args, o) => { seen.push({ args, env: o?.env ?? {} }); const f = fail(args, o?.env ?? {}); if (f) throw new Error(f); return { stdout: out(args), stderr: '' }; } };
};

describe('cloud-side backup jobs', () => {
  it('applies retention per client with that client\'s key, and one failure does not stop the rest', async () => {
    const r = runner((args) => (args.some((a) => a.includes('bad')) ? 'repository unreachable' : null));
    const res = await expireAll([client('a'), client('bad'), client('c')], r);
    expect(res.map((x) => [x.site, x.ok])).toEqual([['a', true], ['bad', false], ['c', true]]);
    expect(res[1]?.detail).toBe('repository unreachable');
    expect(r.seen[0]?.env['PGBACKREST_REPO1_CIPHER_PASS']).toBe('key-of-a'); expect(r.seen[0]?.env['PGBACKREST_REPO2_CIPHER_PASS']).toBe('key-of-a');
    expect(r.seen.at(-1)?.env['PGBACKREST_REPO1_CIPHER_PASS']).toBe('key-of-c');
  });
  it('verifies every repository, and reads damage out of the report even though the command succeeds', async () => {
    const ok = await verifyAll([client('a', 3)], runner(() => null));
    expect(ok[0]).toMatchObject({ ok: true, detail: '3 repositories verified' });
    const damaged = await verifyAll([client('a')], runner(() => null, (args) => (args.includes('--repo=2') ? 'INFO: stanza: onesync\n status: error\n checksum invalid: 1\nINFO: verify command end: completed successfully' : 'INFO: verify command end: completed successfully')));
    expect(damaged[0]?.ok).toBe(false); expect(damaged[0]?.detail).toMatch(/repository 2/);
  });
  it('rotates through the clients so each is tested in turn', () => {
    const cs = ['d', 'a', 'c', 'b', 'e'].map((s) => client(s));
    const seen = new Set<string>();
    for (let m = 0; m < 3; m++) for (const c of sampleFor(cs, m, 2)) seen.add(c.site);
    expect([...seen].sort()).toEqual(['a', 'b', 'c', 'd', 'e']); // five clients, two a month: all covered within three months
    expect(sampleFor(cs, 0, 2).map((c) => c.site)).toEqual(['a', 'b']); // same answer every time it is asked
    expect(sampleFor([], 0, 2)).toEqual([]);
  });
  it('reports each restore test, including one that cannot even start', async () => {
    const good: ScratchPorts = { restoreInto: async () => undefined, start: async () => undefined, query: async (sql) => (sql === 'SELECT 1' ? '1' : sql.includes('information_schema') ? '40' : 'true'), stop: async () => undefined, cleanup: async () => undefined };
    const res = await restoreTests([client('a'), client('b')], async (c) => { if (c.site === 'b') throw new Error('no key in the vault'); return good; }, (c) => `/scratch/${c.site}`);
    expect(res[0]).toMatchObject({ site: 'a', ok: true }); expect(res[1]).toMatchObject({ site: 'b', ok: false, detail: 'no key in the vault' });
  });
});
