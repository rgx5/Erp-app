import { describe, expect, it } from 'vitest';
import { compareVersions, judge, type Heartbeat } from '../src/fleet.js';

const now = new Date('2026-11-19T10:00:00Z');
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
const good: Heartbeat = { version: '1.0.0', db: { ok: true, replicationLagSeconds: 2 }, backup: { lastBaseBackupAt: ago(600), lastWalShippedAt: ago(1), walQueueBytes: 0 }, disk: { freePercent: 60 }, tunnel: { up: true } };
const j = (heartbeat: Heartbeat | null, tier = 'hybrid', seen = 1) => judge({ lastSeenAt: heartbeat ? new Date(now.getTime() - seen * 60_000) : null, heartbeat, tier, silentAfterMinutes: 10, now });

describe('fleet health', () => {
  it('never seen, silent, healthy', () => {
    expect(j(null).state).toBe('never');
    expect(j(good, 'hybrid', 30)).toMatchObject({ state: 'silent' });
    expect(j(good)).toEqual({ state: 'healthy', reasons: [] });
  });
  it('flags each problem with a reason', () => {
    expect(j({ ...good, db: { ok: false } }).reasons).toContain('Database is not healthy');
    expect(j({ ...good, disk: { freePercent: 10 } }).reasons[0]).toMatch(/90% full/);
    expect(j({ ...good, backup: { ...good.backup, lastWalShippedAt: ago(40) } }).reasons[0]).toMatch(/40 minutes ago/);
    expect(j({ ...good, backup: { ...good.backup, lastBaseBackupAt: ago(60 * 48) } }).reasons[0]).toMatch(/48 hours ago/);
    expect(j({ ...good, backup: { ...good.backup, walQueueBytes: 3 * 1024 ** 3 } }).reasons[0]).toMatch(/queue/);
    expect(j({ ...good, tunnel: { up: false } }).reasons).toContain('Remote-access tunnel is down');
    expect(j({ ...good, lastUpgrade: { outcome: 'rolled_back', toVersion: '2.0.0' } }).reasons[0]).toMatch(/Upgrade to 2.0.0 did not finish \(rolled back\)/);
    expect(j({ ...good, lastUpgrade: { outcome: 'success', toVersion: '2.0.0' } }).state).toBe('healthy');
  });
  it('applies tier rules: a local site needs no tunnel, only Plus has a standby', () => {
    expect(j({ ...good, tunnel: { up: false } }, 'local').state).toBe('healthy');
    expect(j({ ...good, db: { ok: true, replicationLagSeconds: 900 } }, 'hybrid').state).toBe('healthy');
    expect(j({ ...good, db: { ok: true, replicationLagSeconds: 900 } }, 'hybrid_plus').reasons).toContain('Live standby is behind');
  });
  it('compares versions by number', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });
});
