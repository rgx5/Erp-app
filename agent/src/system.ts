import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AgentConfig } from './config.js';
import type { HeartbeatPorts } from './heartbeat.js';
import type { LicencePorts } from './licence.js';
import type { SupportPorts } from './support.js';
import type { UpgradePorts } from './upgrade.js';
import type { Manifest } from './verify.js';

const run = promisify(execFile);
const exec = async (cmd: string, args: string[], timeoutMs = 600_000): Promise<string> => (await run(cmd, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 })).stdout.trim();
const readJson = <T>(file: string): T | undefined => { try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { return undefined; } };
const imageRef = (c: AgentConfig, name: string, digest: string): string => `${c.registry}/${name}@${digest}`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function freeDisk(dir: string): number { const s = statfsSync(dir); return (Number(s.bavail) / Number(s.blocks)) * 100; }
async function ready(c: AgentConfig): Promise<boolean> { try { return (await fetch(`${c.localApiUrl}/health/ready`, { signal: AbortSignal.timeout(5_000) })).ok; } catch { return false; } }

export function heartbeatPorts(c: AgentConfig): HeartbeatPorts {
  return {
    dbHealthy: () => ready(c),
    replicationLagSeconds: async () => undefined, // reported once the live standby exists (Hybrid Plus)
    freeDiskPercent: async () => freeDisk(c.dataDir),
    backupStatus: async () => readJson(c.backupStatusFile),
    tunnelUp: async () => readJson<{ up: boolean }>(c.tunnelStatusFile)?.up,
  };
}

/** The real machine, driven through Docker and the backup scripts. These need a real site server to exercise (see agent/deploy). */
export function upgradePorts(c: AgentConfig): UpgradePorts {
  return {
    freeDiskPercent: async () => freeDisk(c.dataDir),
    createBackup: async (label) => { const id = await exec(c.backupCommand, ['now', label]); if (!id) throw new Error('The backup script gave no backup id'); return id; },
    restoreBackup: async (id) => { await exec(c.restoreCommand, [id], 3_600_000); },
    pullImages: async (m: Manifest) => { for (const i of m.images) await exec('docker', ['pull', imageRef(c, i.name, i.digest)]); await exec('docker', ['pull', imageRef(c, 'migrate', m.migrationDigest)]); },
    runMigration: async (m: Manifest) => { await exec('docker', ['run', '--rm', '--network', c.dockerNetwork, '--env-file', c.migratorEnvFile, imageRef(c, 'migrate', m.migrationDigest)], 1_800_000); },
    startRelease: async (m: Manifest) => {
      writeFileSync(c.releaseEnvFile, m.images.map((i) => `${i.name.toUpperCase().replaceAll('-', '_')}_IMAGE=${imageRef(c, i.name, i.digest)}`).join('\n') + `\nRELEASE_VERSION=${m.version}\n`, { mode: 0o640 });
      await exec('docker', ['compose', '-f', c.composeFile, '--env-file', c.releaseEnvFile, 'up', '-d', '--remove-orphans', ...m.images.map((i) => i.name)]);
    },
    healthy: async () => { for (let i = 0; i < 30; i++) { if (await ready(c)) return true; await sleep(3_000); } return false; },
  };
}

export function licencePorts(c: AgentConfig): LicencePorts {
  return {
    importLicence: async (tenantId, signed) => {
      const res = await fetch(`${c.localApiUrl}/v1/platform/tenants/${tenantId}/licence`, { method: 'POST', headers: { authorization: `Bearer ${c.platformAdminToken}`, 'content-type': 'application/json' }, body: JSON.stringify(signed), signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`The server refused the licence (${res.status}): ${await res.text()}`);
    },
  };
}

export function supportPorts(c: AgentConfig): SupportPorts {
  const stamp = (d: Date): string => d.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS (UTC), as OpenSSH's expiry-time wants
  return {
    showCode: async (code) => { if (code) { mkdirSync(path.dirname(c.supportCodeFile), { recursive: true }); writeFileSync(c.supportCodeFile, `${code}\n`, { mode: 0o644 }); } else rmSync(c.supportCodeFile, { force: true }); },
    openAccess: async (publicKey, expiresAt) => {
      mkdirSync(path.dirname(c.supportAuthorizedKeys), { recursive: true });
      writeFileSync(c.supportAuthorizedKeys, `expiry-time="${stamp(expiresAt)}Z",restrict,pty ${publicKey}\n`, { mode: 0o600 });
      chmodSync(c.supportAuthorizedKeys, 0o600);
    },
    closeAccess: async () => { writeFileSync(c.supportAuthorizedKeys, '', { mode: 0o600 }); },
  };
}
