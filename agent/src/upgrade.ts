import type { StateStore, UpgradeResult } from './state.js';
import { releaseProblem, type Manifest } from './verify.js';

/** Everything the upgrade does to the machine, so the procedure can be tested with failures injected at every step. */
export interface UpgradePorts {
  freeDiskPercent(): Promise<number>;
  /** Takes a backup and checks it is readable. Rejects when it cannot. Resolves to a backup id. */
  createBackup(label: string): Promise<string>;
  restoreBackup(id: string): Promise<void>;
  pullImages(m: Manifest): Promise<void>;
  /** Runs the database migration of this release. It is transactional: if it fails, the schema is unchanged. */
  runMigration(m: Manifest): Promise<void>;
  /** Starts the application at this release (replacing the running one). */
  startRelease(m: Manifest): Promise<void>;
  /** Is the application answering and healthy? Retries inside; resolves false when it never does. */
  healthy(): Promise<boolean>;
}
export interface UpgradeOutcome { outcome: 'success' | 'rejected' | 'low_disk' | 'backup_failed' | 'pull_failed' | 'migration_failed' | 'rolled_back' | 'restored' | 'failed'; steps: string[]; detail?: string; fromVersion: string | null; toVersion: string }

export const MIN_FREE_PERCENT = 20;

/**
 * The safe upgrade: check, back up, fetch, migrate, switch, verify. Up to the migration nothing has changed, so a failure just stops.
 * After the switch, an unhealthy release is rolled back (database changes only ever add, so the previous version still works), and
 * if even that is unhealthy the pre-upgrade backup is restored. Every outcome is recorded for the fleet screen.
 */
export async function upgrade(manifest: Manifest, signature: string, o: { ports: UpgradePorts; state: StateStore; publicKey: string; now?: () => Date }): Promise<UpgradeOutcome> {
  const { ports, state } = o;
  const before = state.read();
  const from = before.current?.version ?? null;
  const steps: string[] = [];
  const done = (outcome: UpgradeOutcome['outcome'], detail?: string): UpgradeOutcome => {
    const result: UpgradeResult = { outcome, fromVersion: from, toVersion: manifest.version, at: (o.now?.() ?? new Date()).toISOString() };
    state.update((s) => { s.lastUpgrade = result; });
    return { outcome, steps, ...(detail ? { detail } : {}), fromVersion: from, toVersion: manifest.version };
  };
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => { steps.push(name); return fn(); };

  const problem = releaseProblem(manifest, signature, o.publicKey, from);
  if (problem) return done('rejected', problem);
  if ((await step('check disk', () => ports.freeDiskPercent())) < MIN_FREE_PERCENT) return done('low_disk');

  let backupId: string;
  try { backupId = await step('back up', () => ports.createBackup(`pre-${manifest.version}`)); } catch (e) { return done('backup_failed', message(e)); }
  try { await step('pull images', () => ports.pullImages(manifest)); } catch (e) { return done('pull_failed', message(e)); }
  try { await step('migrate', () => ports.runMigration(manifest)); } catch (e) { return done('migration_failed', message(e)); }

  let switched = false;
  try {
    await step('switch', () => ports.startRelease(manifest));
    switched = true;
    if (await step('verify', () => ports.healthy())) {
      state.update((s) => { s.previous = s.current; s.current = manifest; });
      return done('success');
    }
  } catch (e) { if (!switched) steps.push(`switch failed: ${message(e)}`); }

  // The new release did not come up healthy: go back.
  const previous = before.current;
  if (!previous) return done('failed', 'The first release did not become healthy and there is nothing to go back to');
  try {
    await step('roll back', () => ports.startRelease(previous));
    if (await step('verify rollback', () => ports.healthy())) return done('rolled_back');
  } catch (e) { steps.push(`rollback failed: ${message(e)}`); }
  try {
    await step('restore backup', () => ports.restoreBackup(backupId));
    await step('start previous', () => ports.startRelease(previous));
    return await step('verify restore', () => ports.healthy()) ? done('restored') : done('failed', 'Unhealthy even after restoring the backup');
  } catch (e) { return done('failed', `Restore failed: ${message(e)}`); }
}
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
