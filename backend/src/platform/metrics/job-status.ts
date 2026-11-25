import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Sample { name: string; help: string; samples: { labels?: Record<string, string>; value: number }[] }
const JOBS = ['backup', 'dump', 'drill', 'retention'] as const;

/**
 * The jobs next to the database (continuous backup, daily dump, monthly restore drill, daily housekeeping) each write a small JSON result into a shared
 * folder. This turns those files into metrics, so one scrape shows how old the last good backup is. A missing file means the job never ran (or is not set up).
 */
export function jobMetrics(dir: string | undefined, now: () => number = () => Date.now() / 1000): Sample[] {
  if (!dir) return [];
  const ok: { labels: Record<string, string>; value: number }[] = [];
  const age: typeof ok = [];
  const configured: typeof ok = [];
  const extra: Sample[] = [];
  for (const job of JOBS) {
    let doc: { ok?: boolean; at?: number; lastBaseBackupAt?: number; lastWalShippedAt?: number } | undefined;
    try { doc = JSON.parse(readFileSync(join(dir, `${job}.json`), 'utf8')); } catch { doc = undefined; }
    configured.push({ labels: { job }, value: doc ? 1 : 0 });
    if (!doc) continue;
    ok.push({ labels: { job }, value: doc.ok ? 1 : 0 });
    if (typeof doc.at === 'number') age.push({ labels: { job }, value: Math.max(0, Math.round(now() - doc.at)) });
    if (job === 'backup') {
      if (doc.lastBaseBackupAt) extra.push({ name: 'erp_backup_base_age_seconds', help: 'Age of the newest base backup', samples: [{ value: Math.max(0, Math.round(now() - doc.lastBaseBackupAt)) }] });
      if (doc.lastWalShippedAt) extra.push({ name: 'erp_backup_wal_age_seconds', help: 'Age of the newest shipped write-ahead-log segment (the data you could lose)', samples: [{ value: Math.max(0, Math.round(now() - doc.lastWalShippedAt)) }] });
    }
  }
  return [
    { name: 'erp_job_reported', help: 'Whether a maintenance job has reported at all (1) or never has (0)', samples: configured },
    { name: 'erp_job_last_ok', help: 'Whether the last run of a maintenance job succeeded', samples: ok },
    { name: 'erp_job_last_run_age_seconds', help: 'How long ago a maintenance job last finished', samples: age },
    ...extra,
  ];
}
