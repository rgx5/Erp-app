import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jobMetrics } from './job-status.js';

describe('job status metrics', () => {
  it('reports nothing without a folder, and "never reported" for jobs with no file', () => {
    expect(jobMetrics(undefined)).toEqual([]);
    const dir = mkdtempSync(join(tmpdir(), 'jobs-'));
    const m = jobMetrics(dir);
    expect(m.find((s) => s.name === 'erp_job_reported')?.samples.every((x) => x.value === 0)).toBe(true);
    expect(m.find((s) => s.name === 'erp_job_last_ok')?.samples).toEqual([]);
  });
  it('turns job results into ages and ok flags, including backup and log-shipping age', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobs-'));
    writeFileSync(join(dir, 'backup.json'), JSON.stringify({ ok: true, at: 1000, lastBaseBackupAt: 400, lastWalShippedAt: 990 }));
    writeFileSync(join(dir, 'drill.json'), JSON.stringify({ ok: false, at: 900 }));
    writeFileSync(join(dir, 'dump.json'), 'not json');
    const m = jobMetrics(dir, () => 1010);
    const get = (n: string) => m.find((s) => s.name === n)?.samples;
    expect(get('erp_job_last_ok')).toEqual([{ labels: { job: 'backup' }, value: 1 }, { labels: { job: 'drill' }, value: 0 }]);
    expect(get('erp_job_last_run_age_seconds')).toEqual([{ labels: { job: 'backup' }, value: 10 }, { labels: { job: 'drill' }, value: 110 }]);
    expect(get('erp_backup_base_age_seconds')).toEqual([{ value: 610 }]);
    expect(get('erp_backup_wal_age_seconds')).toEqual([{ value: 20 }]);
  });
});
