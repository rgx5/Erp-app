import { describe, expect, it } from 'vitest';
import { pgbackrestConf, postgresArchiveSettings, type BackupConfig } from '../src/backup/config.js';
import { parseInfo } from '../src/backup/pgbackrest.js';
import { restoreSite, type SiteControl } from '../src/backup/restoreSite.js';
import { ERP_CHECKS, runRestoreTest, type ScratchPorts } from '../src/backup/restoreTest.js';

const cfg: BackupConfig = { stanza: 'onesync', pgDataPath: '/var/lib/postgresql/data', pgSocketPath: '/var/run/postgresql', pgPort: 5432, pgUser: 'postgres', cipherPassFile: '/k/pass', archiveTimeoutSeconds: 60, fullRetention: 4,
  repos: [{ type: 'posix', path: '/var/lib/onesync/backup-repo' }, { type: 's3', bucket: 'onesync-backups', endpoint: 's3.example.in', region: 'ap-south-1', keyFile: '/k/s3key', secretFile: '/k/s3secret', path: '/onesync' }] };
const secrets: Record<string, string> = { '/k/pass': 'the-client-key\n', '/k/s3key': 'AKIAEXAMPLE', '/k/s3secret': 'topsecret' };
const read = (f: string): string => secrets[f] ?? '';

describe('pgBackRest configuration', () => {
  const conf = pgbackrestConf(cfg, read);
  it('encrypts every repository with the client key, and never lets the site expire its own history', () => {
    expect(conf).toContain('repo1-cipher-type=aes-256-cbc'); expect(conf).toContain('repo2-cipher-type=aes-256-cbc');
    expect(conf).toContain('repo1-cipher-pass=the-client-key'); expect(conf).toContain('repo2-cipher-pass=the-client-key');
    expect(conf).toContain('expire-auto=n');
  });
  it('describes each repository and the database', () => {
    expect(conf).toContain('repo1-type=posix'); expect(conf).toContain('repo2-type=s3'); expect(conf).toContain('repo2-s3-bucket=onesync-backups'); expect(conf).toContain('repo2-s3-key=AKIAEXAMPLE'); expect(conf).toContain('repo2-s3-key-secret=topsecret');
    expect(conf).toContain('[onesync]'); expect(conf).toContain('pg1-path=/var/lib/postgresql/data');
  });
  it('makes PostgreSQL ship log segments and force one every minute', () => {
    const s = postgresArchiveSettings(cfg, '/etc/pgbackrest/pgbackrest.conf');
    expect(s).toContain("archive_command = 'pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=onesync archive-push %p'"); expect(s).toContain('archive_timeout = 60'); expect(s).toContain('archive_mode = on');
  });
});

describe('backup information', () => {
  const info = JSON.stringify([{ name: 'onesync', status: { code: 0 }, archive: [{ min: '000000010000000000000001', max: '00000001000000000000000B' }], backup: [
    { label: '20261119-042328F', type: 'full', timestamp: { start: 1795000000, stop: 1795000030 }, database: { 'repo-key': 1 }, annotation: { label: 'first' } },
    { label: '20261119-042328F_20261119-042336I', type: 'incr', timestamp: { start: 1795000100, stop: 1795000110 }, database: { 'repo-key': 1 } }] }]);
  it('reads backups, the log range and health', () => {
    const i = parseInfo(info, 'onesync');
    expect(i).toMatchObject({ ok: true, archiveMax: '00000001000000000000000B', archiveMin: '000000010000000000000001' });
    expect(i.backups.map((b) => [b.label.slice(-1), b.type, b.annotation['label'] ?? null])).toEqual([['F', 'full', 'first'], ['I', 'incr', null]]);
    expect(i.backups[0]?.finishedAt).toBe(new Date(1795000030 * 1000).toISOString());
  });
  it('says not ok for an unknown stanza', () => { expect(parseInfo('[]', 'onesync')).toMatchObject({ ok: false, backups: [] }); });
});

function scratch(o: { fail?: 'restore' | 'start'; results?: Record<string, string> } = {}): ScratchPorts & { log: string[] } {
  const log: string[] = [];
  return { log,
    restoreInto: async () => { log.push('restore'); if (o.fail === 'restore') throw new Error('repository unreachable'); },
    start: async () => { log.push('start'); if (o.fail === 'start') throw new Error('The restored database did not open'); },
    query: async (sql) => { log.push('query'); return o.results?.[sql] ?? (sql === 'SELECT 1' ? '1' : sql.includes('information_schema') ? '40' : 'true'); },
    stop: async () => { log.push('stop'); }, cleanup: async () => { log.push('cleanup'); } };
}
describe('restore test', () => {
  it('restores, opens, checks and always cleans up', async () => {
    const p = scratch(); const r = await runRestoreTest(p, '/tmp/x');
    expect(r.ok).toBe(true); expect(r.checks.every((c) => c.ok)).toBe(true); expect(p.log).toEqual(['restore', 'start', 'query', 'query', 'query', 'stop', 'cleanup']);
  });
  it('fails, with the reason, when the books do not balance or the restore does not open', async () => {
    const unbalanced = await runRestoreTest(scratch({ results: { [ERP_CHECKS[2]?.sql as string]: 'false' } }), '/tmp/x');
    expect(unbalanced.ok).toBe(false); expect(unbalanced.checks.find((c) => !c.ok)).toMatchObject({ name: 'ledger balances (debits equal credits)', detail: 'debits and credits differ' });
    const p = scratch({ fail: 'start' }); const opened = await runRestoreTest(p, '/tmp/x');
    expect(opened).toMatchObject({ ok: false, error: 'The restored database did not open' }); expect(p.log.slice(-2)).toEqual(['stop', 'cleanup']);
    expect((await runRestoreTest(scratch({ fail: 'restore' }), '/tmp/x')).error).toBe('repository unreachable');
  });
});

function site(o: { failAt?: string; healthy?: boolean } = {}): SiteControl & { log: string[] } {
  const log: string[] = [];
  const step = (n: string) => async () => { log.push(n); if (o.failAt === n) throw new Error(`${n} failed`); };
  return { log, stopApp: step('stopApp'), stopDatabase: step('stopDatabase'), restore: async (x) => { log.push(`restore ${JSON.stringify(x)}`); if (o.failAt === 'restore') throw new Error('restore failed'); }, startDatabase: step('startDatabase'), waitDatabaseReady: step('waitDatabaseReady'), startApp: step('startApp'), appHealthy: async () => o.healthy ?? true };
}
describe('restoring a site', () => {
  it('stops everything that writes, restores, and only then starts the application', async () => {
    const s = site(); const r = await restoreSite(s, { backup: '20261119-042328F' });
    expect(r.ok).toBe(true);
    expect(s.log).toEqual(['stopApp', 'stopDatabase', 'restore {"backup":"20261119-042328F"}', 'startDatabase', 'waitDatabaseReady', 'startApp']);
  });
  it('keeps the application stopped when the restore fails, and says where it stopped', async () => {
    const s = site({ failAt: 'restore' }); const r = await restoreSite(s);
    expect(r).toMatchObject({ ok: false, error: 'restore failed' }); expect(s.log).not.toContain('startApp');
    const t = site({ failAt: 'waitDatabaseReady' });
    expect((await restoreSite(t)).steps.at(-1)).toBe('wait for recovery'); expect(t.log).not.toContain('startApp');
    expect((await restoreSite(site({ healthy: false }))).error).toMatch(/not healthy/);
  });
});
