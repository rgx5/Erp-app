import type { AgentState } from './state.js';

/** What the machine can tell about itself. Each reads one thing and may be unavailable (undefined). */
export interface HeartbeatPorts {
  dbHealthy(): Promise<boolean | undefined>;
  replicationLagSeconds(): Promise<number | null | undefined>;
  freeDiskPercent(): Promise<number | undefined>;
  /** Written by the backup shipper. */
  backupStatus(): Promise<{ lastBaseBackupAt: string | null; lastWalShippedAt: string | null; walQueueBytes: number } | undefined>;
  /** Written by the tunnel client. */
  tunnelUp(): Promise<boolean | undefined>;
}

/** The report sent every minute. Only what could be read is included; a missing reading is not reported as a bad one. */
export async function collectHeartbeat(ports: HeartbeatPorts, state: AgentState, agentVersion: string): Promise<Record<string, unknown>> {
  const safe = async <T>(fn: () => Promise<T>): Promise<T | undefined> => { try { return await fn(); } catch { return undefined; } };
  const [db, lag, disk, backup, tunnel] = await Promise.all([safe(ports.dbHealthy), safe(ports.replicationLagSeconds), safe(ports.freeDiskPercent), safe(ports.backupStatus), safe(ports.tunnelUp)]);
  return {
    version: state.current?.version ?? 'unknown', agentVersion,
    ...(db !== undefined || lag !== undefined ? { db: { ...(db !== undefined ? { ok: db } : {}), ...(lag !== undefined ? { replicationLagSeconds: lag } : {}) } } : {}),
    ...(disk !== undefined ? { disk: { freePercent: Math.round(disk * 10) / 10 } } : {}),
    ...(backup ? { backup } : {}),
    ...(tunnel !== undefined ? { tunnel: { up: tunnel } } : {}),
    ...(state.lastUpgrade ? { lastUpgrade: state.lastUpgrade } : {}),
  };
}
