import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Manifest } from './verify.js';

export interface UpgradeResult { outcome: string; fromVersion: string | null; toVersion: string; at: string }
export interface AgentState {
  /** The release that is running, and the one before it (kept so a bad release can be rolled back). */
  current: Manifest | null;
  previous: Manifest | null;
  appliedLicenceId: string | null;
  lastUpgrade: UpgradeResult | null;
  /** A support session in progress on this site: the hash of the code shown to the customer, wrong guesses so far, and whether access is open. */
  support: { sessionId: string; codeHash: string | null; attempts: number; open: boolean; expiresAt: string | null } | null;
}
export const emptyState = (): AgentState => ({ current: null, previous: null, appliedLicenceId: null, lastUpgrade: null, support: null });

/** The agent's memory across restarts: one small JSON file, replaced atomically so a power cut cannot leave half a file. */
export class StateStore {
  constructor(private readonly file: string) {}
  read(): AgentState {
    try { return { ...emptyState(), ...(JSON.parse(readFileSync(this.file, 'utf8')) as Partial<AgentState>) }; } catch { return emptyState(); }
  }
  write(state: AgentState): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  update(fn: (s: AgentState) => void): AgentState { const s = this.read(); fn(s); this.write(s); return s; }
}
