import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Runner } from './pgbackrest.js';
import type { SiteControl } from './restoreSite.js';

const run = promisify(execFile);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export interface DockerSite { composeFile: string; releaseEnvFile: string; localApiUrl: string; dbService?: string; appServices?: string[]; configInContainer: string }

const compose = (d: DockerSite): string[] => ['compose', '-f', d.composeFile, '--env-file', d.releaseEnvFile];

/** Runs commands inside the database container (where pgBackRest and PostgreSQL live). */
export function dockerRunner(d: DockerSite): Runner {
  return { run: async (cmd, args, o) => { const r = await run('docker', [...compose(d), 'exec', '-T', d.dbService ?? 'postgres', cmd, ...args], { timeout: o?.timeoutMs ?? 3_600_000, maxBuffer: 20 * 1024 * 1024 }); return { stdout: r.stdout, stderr: r.stderr }; } };
}

/** Recovers a site on Docker. Not exercised in this repository's tests (no Docker daemon there): the order of steps is covered by restoreSite's tests. */
export function dockerSiteControl(d: DockerSite, stanza: string): SiteControl {
  const db = d.dbService ?? 'postgres'; const apps = d.appServices ?? ['proxy', 'api'];
  const dc = async (...a: string[]) => { await run('docker', [...compose(d), ...a], { timeout: 3_600_000, maxBuffer: 20 * 1024 * 1024 }); };
  return {
    stopApp: () => dc('stop', ...apps),
    stopDatabase: () => dc('stop', db),
    restore: async (o) => { await dc('run', '--rm', '--no-deps', '-T', '--entrypoint', 'pgbackrest', db, `--config=${d.configInContainer}`, `--stanza=${stanza}`, ...(o.repo ? [`--repo=${o.repo}`] : []), 'restore', '--delta', ...(o.backup ? [`--set=${o.backup}`] : []), ...(o.time ? ['--type=time', `--target=${o.time}`, '--target-action=promote'] : [])); },
    startDatabase: () => dc('up', '-d', db),
    waitDatabaseReady: async () => {
      for (let i = 0; i < 120; i++) {
        try { const r = await run('docker', [...compose(d), 'exec', '-T', db, 'psql', '-U', 'postgres', '-d', 'erp', '-Atc', 'SELECT pg_is_in_recovery()']); if (r.stdout.trim() === 'f') return; } catch { /* still starting or recovering */ }
        await sleep(5_000);
      }
      throw new Error('The database did not finish recovery in ten minutes');
    },
    startApp: () => dc('up', '-d', ...apps),
    appHealthy: async () => { for (let i = 0; i < 30; i++) { try { if ((await fetch(`${d.localApiUrl}/health/ready`, { signal: AbortSignal.timeout(5_000) })).ok) return true; } catch { /* not yet */ } await sleep(3_000); } return false; },
  };
}
