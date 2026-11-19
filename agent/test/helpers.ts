import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StateStore } from '../src/state.js';
import type { UpgradePorts } from '../src/upgrade.js';
import { canonical, type Manifest } from '../src/verify.js';

const pair = generateKeyPairSync('ed25519');
export const PUBLIC = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
export const signManifest = (m: Manifest, key = pair.privateKey): string => sign(null, Buffer.from(canonical(m)), key).toString('base64');
export const manifest = (version: string, o: Partial<Manifest> = {}): Manifest => ({ version, images: [{ name: 'api', digest: `sha256:${'a'.repeat(64)}` }], migrationDigest: `sha256:${'b'.repeat(64)}`, minClientVersion: null, maxClientVersion: null, notes: '', createdAt: '2026-11-19T00:00:00.000Z', ...o });
export const tempState = (): StateStore => new StateStore(path.join(mkdtempSync(path.join(tmpdir(), 'agent-')), 'state.json'));

/** Fake machine: records every call, and any step can be told to fail or report unhealthy. */
export function fakePorts(o: { disk?: number; failAt?: Partial<Record<'createBackup' | 'pullImages' | 'runMigration' | 'startNew' | 'startPrevious' | 'restoreBackup', boolean>>; healthyNew?: boolean; healthyPrevious?: boolean; healthyAfterRestore?: boolean } = {}): UpgradePorts & { calls: string[] } {
  const calls: string[] = [];
  let restored = false; let running: string | null = null;
  const failAt = o.failAt ?? {};
  return {
    calls,
    freeDiskPercent: async () => { calls.push('disk'); return o.disk ?? 60; },
    createBackup: async (label) => { calls.push(`backup ${label}`); if (failAt.createBackup) throw new Error('backup disk is full'); return 'bk-1'; },
    restoreBackup: async (id) => { calls.push(`restore ${id}`); if (failAt.restoreBackup) throw new Error('restore failed'); restored = true; },
    pullImages: async (m) => { calls.push(`pull ${m.version}`); if (failAt.pullImages) throw new Error('registry unreachable'); },
    runMigration: async (m) => { calls.push(`migrate ${m.version}`); if (failAt.runMigration) throw new Error('migration 0042 failed'); },
    startRelease: async (m) => {
      calls.push(`start ${m.version}`);
      const isPrevious = m.version.startsWith('1.');
      if (isPrevious ? failAt.startPrevious : failAt.startNew) throw new Error('could not start containers');
      running = m.version;
    },
    healthy: async () => { calls.push('health'); if (restored) return o.healthyAfterRestore ?? true; return running?.startsWith('2.') ? (o.healthyNew ?? true) : (o.healthyPrevious ?? true); },
  };
}
