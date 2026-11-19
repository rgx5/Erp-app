import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { promisify } from 'node:util';
import type { ScratchPorts } from './restoreTest.js';

const run = promisify(execFile);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface NativeScratch {
  /** Directory holding PostgreSQL's binaries (pg_ctl, psql). */
  pgBin: string;
  configFile: string;
  stanza: string;
  /** Where the throwaway database listens (a port nothing else uses) and keeps its socket. */
  port: number;
  sockDir: string;
  logFile: string;
  /** Run the database tools as this operating-system user (when started as root). */
  asUser?: string;
  /** The first repository holding the backups to test (1, 2 ...). */
  repo?: number;
}

/**
 * A restore test on a machine with PostgreSQL installed: restores into a scratch directory, starts a throwaway database on it with archiving
 * switched OFF (it must never write into the real repository), and answers queries. Used on the verification host and in the tests.
 */
export function nativeScratchPorts(o: NativeScratch): ScratchPorts {
  const as = (cmd: string, args: string[]) => (o.asUser ? run('runuser', ['-u', o.asUser, '--', cmd, ...args], { timeout: 3_600_000, maxBuffer: 20 * 1024 * 1024 }) : run(cmd, args, { timeout: 3_600_000, maxBuffer: 20 * 1024 * 1024 }));
  let dir = '';
  const psql = async (sql: string) => (await as(`${o.pgBin}/psql`, ['-h', o.sockDir, '-p', String(o.port), '-U', 'postgres', '-d', 'postgres', '-Atc', sql])).stdout.trim();
  return {
    restoreInto: async (d, t) => {
      dir = d; mkdirSync(d, { recursive: true });
      if (o.asUser) await run('chown', [`${o.asUser}:${o.asUser}`, d]);
      chmodSync(d, 0o700);
      await as('pgbackrest', [`--config=${o.configFile}`, `--stanza=${o.stanza}`, `--pg1-path=${d}`, ...(o.repo ? [`--repo=${o.repo}`] : []), 'restore', '--delta',
        ...(t.backup ? [`--set=${t.backup}`] : []), ...(t.time ? ['--type=time', `--target=${t.time}`, '--target-action=promote'] : [])]);
    },
    start: async (d) => {
      await as(`${o.pgBin}/pg_ctl`, ['-D', d, '-o', `-c port=${o.port} -c unix_socket_directories=${o.sockDir} -c listen_addresses= -c archive_mode=off -c archive_command=/bin/true`, '-l', o.logFile, '-w', 'start']);
      for (let i = 0; i < 60; i++) { try { if ((await psql('SELECT pg_is_in_recovery()')) === 'f') return; } catch { /* still starting */ } await sleep(1000); }
      throw new Error('The restored database did not open');
    },
    query: psql,
    stop: async () => { if (dir) await as(`${o.pgBin}/pg_ctl`, ['-D', dir, '-m', 'immediate', 'stop']).catch(() => undefined); },
    cleanup: async (d) => { rmSync(d, { recursive: true, force: true }); },
  };
}
