/**
 * The site's backup command, installed as `onesync-backup` and `onesync-restore`.
 *   backup-cli init                          register the database with the repositories and check log shipping works
 *   backup-cli backup now <label> [--full]   take a backup into every repository; prints its label (the agent reads this)
 *   backup-cli backup status                 write the status file the agent reports from
 *   backup-cli backup verify                 check every repository's checksums
 *   backup-cli restore [<label>] [--time T] [--repo N]   rebuild the database from the repository (stops the application first)
 *   backup-cli write-config                  write pgbackrest.conf from /etc/onesync/backup.json
 *   backup-cli restore-test [--time T]       (verification host) restore into a scratch database and check it
 */
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { pgbackrestConf, type BackupConfig } from './backup/config.js';
import { dockerRunner, dockerSiteControl, type DockerSite } from './backup/docker.js';
import { nativeScratchPorts } from './backup/native.js';
import { PgBackRest } from './backup/pgbackrest.js';
import { restoreSite } from './backup/restoreSite.js';
import { runRestoreTest } from './backup/restoreTest.js';

const env = process.env;
const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8')) as T;
const backupJson = env['BACKUP_JSON'] ?? '/etc/onesync/backup.json';
const docker: DockerSite = { composeFile: env['COMPOSE_FILE'] ?? '/opt/onesync/docker-compose.site.yml', releaseEnvFile: env['RELEASE_ENV_FILE'] ?? '/etc/onesync/release.env', localApiUrl: env['LOCAL_API_URL'] ?? 'http://127.0.0.1:8080', configInContainer: '/etc/pgbackrest/pgbackrest.conf' };
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string): boolean => args.includes(`--${name}`);
const fail = (m: string): never => { console.error(m); process.exit(1); };

function client(): PgBackRest {
  const cfg = readJson<BackupConfig>(backupJson);
  return new PgBackRest(dockerRunner(docker), { stanza: cfg.stanza, configFile: docker.configInContainer, repoCount: cfg.repos.length, env: {}, statusFile: env['BACKUP_STATUS_FILE'] ?? '/var/lib/onesync/backup-status.json', psqlArgs: ['-U', 'postgres', '-d', 'erp'] });
}

const [cmd, sub] = args;
try {
  if (cmd === 'write-config') {
    const cfg = readJson<BackupConfig>(backupJson);
    const out = env['PGBACKREST_CONF_OUT'] ?? '/etc/onesync/pgbackrest.conf';
    writeFileSync(out, pgbackrestConf(cfg, (f) => readFileSync(f, 'utf8')), { mode: 0o600 });
    chmodSync(out, 0o600);
    console.error(`wrote ${out} (mode 0600; it holds the backup key, so make it readable by the database user only)`);
  } else if (cmd === 'init') {
    await client().init(); console.error('backups are set up');
  } else if (cmd === 'backup' && sub === 'now') {
    const label = args[2]; if (!label) fail('usage: backup now <label> [--full]');
    const br = client();
    const id = await br.backup(label as string, { full: has('full') });
    await br.writeStatus().catch(() => undefined);
    console.log(id);
  } else if (cmd === 'backup' && sub === 'status') {
    console.log(JSON.stringify(await client().writeStatus()));
  } else if (cmd === 'backup' && sub === 'verify') {
    await client().verify(); console.error('every repository verified');
  } else if (cmd === 'restore') {
    const cfg = readJson<BackupConfig>(backupJson);
    const backup = args[1] && !args[1].startsWith('--') && args[1] !== 'latest' ? args[1] : undefined;
    const result = await restoreSite(dockerSiteControl(docker, cfg.stanza), { ...(backup ? { backup } : {}), ...(flag('time') ? { time: flag('time') as string } : {}), ...(flag('repo') ? { repo: Number(flag('repo')) } : {}) });
    console.error(result.steps.join(' > '));
    if (!result.ok) fail(`restore stopped: ${result.error} (the application was left stopped)`);
    console.error('restored; the application is running');
  } else if (cmd === 'restore-test') {
    const cfgFile = env['PGBACKREST_CONF_OUT'] ?? '/etc/onesync/pgbackrest.conf';
    const cfg = readJson<BackupConfig>(backupJson);
    const ports = nativeScratchPorts({ pgBin: env['NATIVE_PG_BIN'] ?? '/usr/lib/postgresql/16/bin', configFile: cfgFile, stanza: cfg.stanza, port: Number(env['SCRATCH_PORT'] ?? 55440), sockDir: env['SCRATCH_SOCK'] ?? '/tmp', logFile: env['SCRATCH_LOG'] ?? '/tmp/restore-test.log', ...(env['SCRATCH_USER'] ? { asUser: env['SCRATCH_USER'] } : {}) });
    const report = await runRestoreTest(ports, env['SCRATCH_DIR'] ?? '/var/tmp/onesync-restore-test', { ...(flag('time') ? { time: flag('time') as string } : {}) });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exit(1);
  } else fail('usage: backup-cli init | backup now <label> [--full] | backup status | backup verify | restore [label] [--time T] | write-config | restore-test');
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
