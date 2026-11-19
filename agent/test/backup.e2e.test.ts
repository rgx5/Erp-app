import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgbackrestConf, postgresArchiveSettings, type BackupConfig } from '../src/backup/config.js';
import { PgBackRest, type Runner } from '../src/backup/pgbackrest.js';
import { nativeScratchPorts } from '../src/backup/native.js';
import { runRestoreTest } from '../src/backup/restoreTest.js';

// A real PostgreSQL cluster and real pgBackRest, as the postgres user. Needs root, pgbackrest and PostgreSQL 16 binaries: skipped without them.
const PGBIN = '/usr/lib/postgresql/16/bin';
const ready = existsSync('/usr/bin/pgbackrest') && existsSync(`${PGBIN}/initdb`) && process.getuid?.() === 0;
const run = promisify(execFile);
const asPg = (cmd: string, args: string[], env: Record<string, string> = {}) => run('runuser', ['-u', 'postgres', '--', 'env', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), cmd, ...args], { timeout: 300_000, maxBuffer: 20 * 1024 * 1024 });
const runner: Runner = { run: async (cmd, args, o) => { const r = await asPg(cmd, args, o?.env ?? {}); return { stdout: r.stdout, stderr: r.stderr }; } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!ready)('encrypted continuous backup, with a real database', () => {
  const root = ready ? mkdtempSync(path.join(tmpdir(), 'bk-')) : '';
  const p = (...s: string[]) => path.join(root, ...s);
  const PORT = 55439;
  let cfg: BackupConfig; let br: PgBackRest; let env: Record<string, string>;
  const conf = () => p('pgbackrest.conf');
  const psql = (sql: string, port = PORT) => asPg(`${PGBIN}/psql`, ['-h', p('sock'), '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-Atc', sql]).then((r) => r.stdout.trim());
  const waitArchived = async (port = PORT) => { await psql('SELECT pg_switch_wal()', port); for (let i = 0; i < 30; i++) { if ((await psql('SELECT archived_count - failed_count FROM pg_stat_archiver', port)) !== '' && Number(await psql("SELECT count(*) FROM pg_ls_archive_statusdir() WHERE name LIKE '%.ready'", port)) === 0) return; await sleep(1000); } throw new Error('log segments were not shipped'); };

  beforeAll(async () => {
    for (const d of ['data', 'sock', 'repo1', 'repo2', 'status']) mkdirSync(p(d), { recursive: true });
    writeFileSync(p('cipher.pass'), 'correct horse battery staple, once per client');
    cfg = { stanza: 'onesync', pgDataPath: p('data'), pgSocketPath: p('sock'), pgPort: PORT, pgUser: 'postgres', repos: [{ type: 'posix', path: p('repo1') }, { type: 'posix', path: p('repo2') }], cipherPassFile: p('cipher.pass'), archiveTimeoutSeconds: 60, fullRetention: 4 };
    writeFileSync(conf(), pgbackrestConf(cfg, (f) => readFileSync(f, 'utf8')), { mode: 0o600 });
    env = {};
    await run('chown', ['-R', 'postgres:postgres', root]);
    await run('chmod', ['755', root]);
    await asPg(`${PGBIN}/initdb`, ['-D', p('data'), '-A', 'trust', '-U', 'postgres']);
    appendFileSync(p('data', 'postgresql.conf'), `\nport = ${PORT}\nlisten_addresses = ''\nunix_socket_directories = '${p('sock')}'\n${postgresArchiveSettings(cfg, conf())}`);
    await run('chown', ['postgres:postgres', p('data', 'postgresql.conf')]);
    await asPg(`${PGBIN}/pg_ctl`, ['-D', p('data'), '-l', p('pg.log'), '-w', 'start']);
    br = new PgBackRest({ run: async (c, a, o) => { const r = await asPg(c, a, { ...(o?.env ?? {}) }); return r; } }, { stanza: 'onesync', configFile: conf(), repoCount: 2, env, statusFile: p('status', 'backup-status.json'), psqlArgs: ['-h', p('sock'), '-p', String(PORT), '-U', 'postgres', '-d', 'postgres'] });
    // the psql command used for status must be found by name: point it at the real binary
    (br as unknown as { r: Runner }).r = { run: async (c, a, o) => asPg(c === 'psql' ? `${PGBIN}/psql` : c, a, o?.env ?? {}) };
    await psql('CREATE TABLE ledger (id serial PRIMARY KEY, note text)');
    await psql("INSERT INTO ledger (note) SELECT 'SECRET-MARKER-9f3a ' || g FROM generate_series(1, 1000) g");
    await br.init();
  }, 120_000);

  afterAll(async () => {
    if (!ready) return;
    await asPg(`${PGBIN}/pg_ctl`, ['-D', p('data'), '-m', 'immediate', 'stop']).catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }, 60_000);

  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : []));
  let first = ''; let second = ''; let tPit = '';
  const count = (port = PORT) => psql('SELECT count(*) FROM ledger', port);

  it('backs up into both repositories, and stores only ciphertext', async () => {
    first = await br.backup('first');
    expect(first).toMatch(/F$/); // the first backup is a full one
    for (const repo of ['repo1', 'repo2']) {
      const list = files(p(repo));
      expect(list.length).toBeGreaterThan(5);
      for (const f of list) expect(readFileSync(f).includes('SECRET-MARKER-9f3a'), `${f} holds plaintext`).toBe(false);
    }
    expect((await br.info()).backups.map((b) => b.annotation['label'])).toContain('first');
  }, 180_000);

  it('ships log continuously, takes an incremental backup, and reports status for the fleet screen', async () => {
    await psql("INSERT INTO ledger (note) SELECT 'a' || g FROM generate_series(1, 200) g"); // 1200 rows
    tPit = await psql("SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'");
    await sleep(1500);
    await psql("INSERT INTO ledger (note) SELECT 'b' || g FROM generate_series(1, 300) g"); // 1500 rows
    await waitArchived();
    second = await br.backup('second');
    expect(second).toMatch(/I$/);
    await psql("INSERT INTO ledger (note) SELECT 'c' || g FROM generate_series(1, 100) g"); // 1600 rows, only in the log
    await waitArchived();
    const status = await br.writeStatus();
    expect(Date.now() - new Date(status.lastBaseBackupAt as string).getTime()).toBeLessThan(5 * 60_000);
    expect(Date.now() - new Date(status.lastWalShippedAt as string).getTime()).toBeLessThan(5 * 60_000);
    expect(status.walQueueBytes).toBe(0);
    expect(JSON.parse(readFileSync(p('status', 'backup-status.json'), 'utf8'))).toMatchObject({ walQueueBytes: 0 });
    await br.verify();
  }, 240_000);

  it('restores to a chosen moment in time without touching the live database, and a restore test reports it', async () => {
    const scratch = p('scratch');
    const ports = nativeScratchPorts({ pgBin: PGBIN, configFile: conf(), stanza: 'onesync', port: 55440, sockDir: p('sock'), logFile: p('scratch.log'), asUser: 'postgres' });
    const report = await runRestoreTest(ports, scratch, { backup: first, time: tPit, checks: [{ name: 'rows at that moment', sql: 'SELECT count(*) FROM ledger', expect: (r) => r === '1200' || `expected 1200 rows, found ${r}` }, { name: 'opens', sql: 'SELECT 1', expect: (r) => r === '1' }] });
    expect(report, JSON.stringify(report)).toMatchObject({ ok: true });
    expect(await count()).toBe('1600'); // the live database was never touched
  }, 240_000);

  it('rebuilds a destroyed server from the repository, including work that only existed in the shipped log', async () => {
    await asPg(`${PGBIN}/pg_ctl`, ['-D', p('data'), '-m', 'immediate', 'stop']);
    for (const f of readdirSync(p('data'))) rmSync(p('data', f), { recursive: true, force: true }); // the disk is gone
    await br.restore();
    await asPg(`${PGBIN}/pg_ctl`, ['-D', p('data'), '-l', p('pg.log'), '-w', 'start']);
    for (let i = 0; i < 30 && (await psql('SELECT pg_is_in_recovery()').catch(() => 't')) !== 'f'; i++) await sleep(1000);
    expect(await count()).toBe('1600'); // the 100 rows written after the last backup came back from the log
    expect(await psql("SELECT count(*) FROM ledger WHERE note LIKE 'SECRET-MARKER-9f3a%'")).toBe('1000');
  }, 240_000);

  it('survives the loss of one repository, and notices a damaged one', async () => {
    // the second repository alone can restore (the first is "lost")
    const lost = readdirSync(p('repo1')); expect(lost.length).toBeGreaterThan(0);
    await br.verify();
    const victim = files(p('repo2')).filter((f) => f.includes('/pg_data/') && statSync(f).size > 200).sort((a, b) => statSync(b).size - statSync(a).size)[0];
    expect(victim).toBeDefined();
    const original = readFileSync(victim as string);
    const damaged = Buffer.from(original); const at = Math.floor(damaged.length / 2); damaged[at] = (damaged[at] ?? 0) ^ 0xff; // flip a byte
    writeFileSync(victim as string, damaged);
    await expect(br.verify()).rejects.toThrow(/Repository 2 failed verification/);
    writeFileSync(victim as string, original); // put it back
  }, 240_000);
});
