/** What a site reports every minute. Everything optional: an agent reports what it has. */
export interface Heartbeat {
  version?: string; agentVersion?: string;
  db?: { ok?: boolean; replicationLagSeconds?: number | null };
  backup?: { lastBaseBackupAt?: string | null; lastWalShippedAt?: string | null; walQueueBytes?: number };
  disk?: { freePercent?: number };
  tunnel?: { up?: boolean };
  lastUserActivityAt?: string | null;
}
export type FleetState = 'healthy' | 'degraded' | 'silent' | 'never';
export interface Judgement { state: FleetState; reasons: string[] }

/** Thresholds. Internal targets until the pilot drills have measured real ones (decision log item 12). */
export const LIMITS = { walShipMinutes: 15, baseBackupHours: 36, diskFreeMinPercent: 20, walQueueBytes: 2 * 1024 ** 3, replicationLagSeconds: 300 } as const;

const minutesSince = (iso: string | null | undefined, now: Date): number | null => (iso ? (now.getTime() - new Date(iso).getTime()) / 60_000 : null);

/** Is this site healthy? Pure, so the rules can be tested and tuned without a database. */
export function judge(input: { lastSeenAt: Date | null; heartbeat: Heartbeat | null; tier: string; silentAfterMinutes: number; now?: Date }): Judgement {
  const now = input.now ?? new Date();
  if (!input.lastSeenAt || !input.heartbeat) return { state: 'never', reasons: ['No heartbeat yet'] };
  const silent = (now.getTime() - input.lastSeenAt.getTime()) / 60_000;
  if (silent > input.silentAfterMinutes) return { state: 'silent', reasons: [`No heartbeat for ${Math.floor(silent)} minutes`] };
  const h = input.heartbeat;
  const reasons: string[] = [];
  if (h.db?.ok === false) reasons.push('Database is not healthy');
  if (h.disk?.freePercent !== undefined && h.disk.freePercent < LIMITS.diskFreeMinPercent) reasons.push(`Disk is ${Math.round(100 - h.disk.freePercent)}% full`);
  const wal = minutesSince(h.backup?.lastWalShippedAt, now);
  if (h.backup && (wal === null || wal > LIMITS.walShipMinutes)) reasons.push(wal === null ? 'No log shipping yet' : `Last log shipped ${Math.floor(wal)} minutes ago`);
  const base = minutesSince(h.backup?.lastBaseBackupAt, now);
  if (h.backup && (base === null || base > LIMITS.baseBackupHours * 60)) reasons.push(base === null ? 'No base backup yet' : `Last base backup ${Math.floor(base / 60)} hours ago`);
  if ((h.backup?.walQueueBytes ?? 0) > LIMITS.walQueueBytes) reasons.push('Backup queue is growing on the site disk');
  if (input.tier !== 'local' && input.tier !== 'cloud' && h.tunnel?.up === false) reasons.push('Remote-access tunnel is down');
  if (input.tier === 'hybrid_plus' && (h.db?.replicationLagSeconds ?? 0) > LIMITS.replicationLagSeconds) reasons.push('Live standby is behind');
  return { state: reasons.length ? 'degraded' : 'healthy', reasons };
}

export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number); const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d !== 0) return d; }
  return 0;
}
