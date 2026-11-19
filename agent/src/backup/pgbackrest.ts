import { writeFileSync } from 'node:fs';

export interface Runner { run(cmd: string, args: string[], o?: { env?: Record<string, string>; timeoutMs?: number }): Promise<{ stdout: string; stderr: string }> }

export interface BackupEntry { label: string; type: 'full' | 'diff' | 'incr'; startedAt: string; finishedAt: string; repo: number; annotation: Record<string, string> }
export interface StanzaInfo { backups: BackupEntry[]; archiveMax: string | null; archiveMin: string | null; ok: boolean }

/** Reads `pgbackrest info --output=json`. */
export function parseInfo(json: string, stanza: string): StanzaInfo {
  const all = JSON.parse(json) as Array<{ name: string; status: { code: number }; archive?: Array<{ min?: string; max?: string }>; backup?: Array<{ label: string; type: string; timestamp: { start: number; stop: number }; database?: { 'repo-key': number }; annotation?: Record<string, string> }> }>;
  const s = all.find((x) => x.name === stanza);
  if (!s) return { backups: [], archiveMax: null, archiveMin: null, ok: false };
  const iso = (t: number): string => new Date(t * 1000).toISOString();
  const backups = (s.backup ?? []).map((b) => ({ label: b.label, type: b.type as BackupEntry['type'], startedAt: iso(b.timestamp.start), finishedAt: iso(b.timestamp.stop), repo: b.database?.['repo-key'] ?? 1, annotation: b.annotation ?? {} }));
  return { backups, archiveMax: s.archive?.[0]?.max ?? null, archiveMin: s.archive?.[0]?.min ?? null, ok: s.status.code === 0 };
}

export interface BackupSettings { stanza: string; configFile: string; repoCount: number; env: Record<string, string>; statusFile: string; psqlArgs: string[]; walSegmentBytes?: number; walDir?: string }

/** Drives pgBackRest. Every step is a command through a Runner, so the same code runs on a site (inside the database container) and in tests. */
export class PgBackRest {
  constructor(private readonly r: Runner, private readonly s: BackupSettings) {}
  private args(...a: string[]): string[] { return [`--config=${this.s.configFile}`, `--stanza=${this.s.stanza}`, ...a]; }
  private run(a: string[], timeoutMs = 3_600_000) { return this.r.run('pgbackrest', this.args(...a), { env: this.s.env, timeoutMs }); }

  /** Registers the database with the repositories (once), and checks that log shipping works end to end. */
  async init(): Promise<void> { await this.run(['stanza-create']); await this.run(['check']); }
  async info(): Promise<StanzaInfo> { return parseInfo((await this.run(['info', '--output=json'])).stdout, this.s.stanza); }

  /**
   * Takes a backup into every repository and returns its label. The first backup is a full one; later ones are incremental unless a full is asked for.
   * A backup that fails in any repository fails the whole call: the agent must not upgrade on a half-protected site.
   */
  async backup(label: string, o: { full?: boolean } = {}): Promise<string> {
    const before = await this.info();
    const type = o.full || before.backups.length === 0 ? 'full' : 'incr';
    for (let repo = 1; repo <= this.s.repoCount; repo++) await this.run(['backup', `--type=${type}`, `--repo=${repo}`, `--annotation=label=${label}`]);
    const after = await this.info();
    const latest = [...after.backups].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0];
    if (!latest) throw new Error('The backup finished but no backup is listed');
    return latest.label;
  }

  /**
   * Checks every repository's contents against its checksums, one repository at a time. Rejects when anything is wrong.
   * pgBackRest reports damage in its output (a stanza summary with `status: error`) but still exits successfully, and prints nothing extra when all is well, so the report is read.
   */
  async verify(): Promise<void> {
    for (let repo = 1; repo <= this.s.repoCount; repo++) {
      const r = await this.run(['verify', `--repo=${repo}`, '--log-level-console=info']);
      const text = `${r.stdout}\n${r.stderr}`;
      if (/status:\s*error/i.test(text) || /invalid|missing/i.test(text.split('stanza:')[1] ?? '')) throw new Error(`Repository ${repo} failed verification:\n${text.split('stanza:')[1]?.trim() ?? text.trim()}`);
      if (!/verify command end: completed successfully/i.test(text)) throw new Error(`Repository ${repo}: verification did not complete:\n${text.trim().slice(-500)}`);
    }
  }

  /** Restores into the database directory, which must be empty or stopped (delta replaces what differs). `target`: a backup label, a time, or nothing for the latest. */
  async restore(o: { backup?: string; time?: string; repo?: number } = {}): Promise<void> {
    const a = ['restore', '--delta'];
    if (o.backup) a.push(`--set=${o.backup}`);
    if (o.time) a.push('--type=time', `--target=${o.time}`, '--target-action=promote');
    if (o.repo) a.push(`--repo=${o.repo}`);
    await this.run(a);
  }

  /** What the fleet needs to know: the newest backup, and when the last log segment was shipped. Written to the status file the agent reports from. */
  async writeStatus(): Promise<{ lastBaseBackupAt: string | null; lastWalShippedAt: string | null; walQueueBytes: number }> {
    const info = await this.info().catch(() => null);
    const base = info ? ([...info.backups].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0]?.finishedAt ?? null) : null;
    const archiver = await this.r.run('psql', [...this.s.psqlArgs, '-Atc', "SELECT coalesce(to_char(last_archived_time AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), '') || '|' || (SELECT count(*) FROM pg_ls_archive_statusdir() WHERE name LIKE '%.ready') FROM pg_stat_archiver"]).catch(() => null);
    const [when, ready] = (archiver?.stdout.trim() ?? '|0').split('|');
    const status = { lastBaseBackupAt: base, lastWalShippedAt: when ? when : null, walQueueBytes: Number(ready ?? 0) * (this.s.walSegmentBytes ?? 16 * 1024 * 1024) };
    writeFileSync(this.s.statusFile, JSON.stringify(status, null, 2), { mode: 0o644 });
    return status;
  }
}
