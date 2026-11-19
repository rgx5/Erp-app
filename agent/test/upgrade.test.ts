import { describe, expect, it } from 'vitest';
import { upgrade } from '../src/upgrade.js';
import { fakePorts, manifest, PUBLIC, signManifest, tempState } from './helpers.js';

const v1 = manifest('1.0.0'); const v2 = manifest('2.0.0');
function setup(o: Parameters<typeof fakePorts>[0] = {}, withCurrent = true) {
  const state = tempState();
  if (withCurrent) state.update((s) => { s.current = v1; });
  const ports = fakePorts(o);
  const go = (m = v2, sig = signManifest(m)) => upgrade(m, sig, { ports, state, publicKey: PUBLIC, now: () => new Date('2026-11-22T02:00:00Z') });
  return { state, ports, go };
}

describe('safe upgrade', () => {
  it('backs up, fetches, migrates, switches, checks, and records the new release', async () => {
    const { state, ports, go } = setup();
    const r = await go();
    expect(r).toMatchObject({ outcome: 'success', fromVersion: '1.0.0', toVersion: '2.0.0' });
    expect(ports.calls).toEqual(['disk', 'backup pre-2.0.0', 'pull 2.0.0', 'migrate 2.0.0', 'start 2.0.0', 'health']);
    expect(state.read()).toMatchObject({ current: { version: '2.0.0' }, previous: { version: '1.0.0' }, lastUpgrade: { outcome: 'success', toVersion: '2.0.0' } });
  });

  it('touches nothing when the release is not signed by the control plane', async () => {
    const { ports, go, state } = setup();
    const r = await go(v2, signManifest(manifest('2.0.1')));
    expect(r).toMatchObject({ outcome: 'rejected', detail: 'signature_invalid' });
    expect(ports.calls).toEqual([]);
    expect(state.read().current?.version).toBe('1.0.0');
  });

  it('stops before changing anything when the disk is nearly full, the backup fails, or the images cannot be fetched', async () => {
    const disk = setup({ disk: 5 }); expect((await disk.go()).outcome).toBe('low_disk'); expect(disk.ports.calls).toEqual(['disk']);
    const bk = setup({ failAt: { createBackup: true } }); expect(await bk.go()).toMatchObject({ outcome: 'backup_failed', detail: 'backup disk is full' }); expect(bk.ports.calls).not.toContain('migrate 2.0.0');
    const pull = setup({ failAt: { pullImages: true } }); expect((await pull.go()).outcome).toBe('pull_failed'); expect(pull.ports.calls).not.toContain('migrate 2.0.0');
    for (const s of [disk, bk, pull]) expect(s.state.read().current?.version).toBe('1.0.0');
  });

  it('leaves the running release alone when the migration fails (the migration is all-or-nothing)', async () => {
    const { ports, go, state } = setup({ failAt: { runMigration: true } });
    expect(await go()).toMatchObject({ outcome: 'migration_failed', detail: 'migration 0042 failed' });
    expect(ports.calls.some((c) => c.startsWith('start'))).toBe(false); // never switched
    expect(state.read()).toMatchObject({ current: { version: '1.0.0' }, lastUpgrade: { outcome: 'migration_failed' } });
  });

  it('rolls back to the previous release when the new one does not come up healthy', async () => {
    const { ports, go, state } = setup({ healthyNew: false });
    const r = await go();
    expect(r.outcome).toBe('rolled_back');
    expect(ports.calls).toEqual(['disk', 'backup pre-2.0.0', 'pull 2.0.0', 'migrate 2.0.0', 'start 2.0.0', 'health', 'start 1.0.0', 'health']);
    expect(state.read()).toMatchObject({ current: { version: '1.0.0' }, lastUpgrade: { outcome: 'rolled_back', toVersion: '2.0.0' } });
  });

  it('rolls back too when the new release will not even start', async () => {
    const { ports, go } = setup({ failAt: { startNew: true } });
    expect((await go()).outcome).toBe('rolled_back');
    expect(ports.calls).toContain('start 1.0.0');
  });

  it('restores the pre-upgrade backup when even the rollback is unhealthy', async () => {
    const { ports, go } = setup({ healthyNew: false, healthyPrevious: false, healthyAfterRestore: true });
    const r = await go();
    expect(r.outcome).toBe('restored');
    expect(ports.calls).toContain('restore bk-1');
  });

  it('reports failure, loudly, when nothing brings the site back', async () => {
    const both = setup({ healthyNew: false, healthyPrevious: false, healthyAfterRestore: false });
    expect(await both.go()).toMatchObject({ outcome: 'failed', detail: 'Unhealthy even after restoring the backup' });
    const noRestore = setup({ healthyNew: false, healthyPrevious: false, failAt: { restoreBackup: true } });
    expect((await noRestore.go()).outcome).toBe('failed');
    const first = setup({ healthyNew: false }, false); // a first install has nothing to go back to
    expect((await first.go()).outcome).toBe('failed');
  });

  it('will not install the same or an older release', async () => {
    const { go, ports } = setup();
    expect((await go(manifest('1.0.0'))).detail).toBe('not_newer');
    expect(ports.calls).toEqual([]);
  });
});
