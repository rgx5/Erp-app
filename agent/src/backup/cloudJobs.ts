import type { Runner } from './pgbackrest.js';
import type { RestoreTestReport, ScratchPorts } from './restoreTest.js';
import { runRestoreTest } from './restoreTest.js';

/** One client's backups, as the cloud-side jobs see them. The key comes from the cloud secret manager at run time (never from disk at rest). */
export interface CloudClient { site: string; stanza: string; configFile: string; repoCount: number; cipherPass: () => Promise<string> }
export interface JobResult { site: string; ok: boolean; detail: string }

const envFor = async (c: CloudClient): Promise<Record<string, string>> => { const pass = await c.cipherPass(); return Object.fromEntries(Array.from({ length: c.repoCount }, (_, i) => [`PGBACKREST_REPO${i + 1}_CIPHER_PASS`, pass])); };

/** Applies each client's retention from the cloud side (sites cannot expire their own backups). One client failing does not stop the others. */
export async function expireAll(clients: CloudClient[], r: Runner): Promise<JobResult[]> {
  const out: JobResult[] = [];
  for (const c of clients) {
    try { await r.run('pgbackrest', [`--config=${c.configFile}`, `--stanza=${c.stanza}`, 'expire'], { env: await envFor(c), timeoutMs: 1_800_000 }); out.push({ site: c.site, ok: true, detail: 'retention applied' }); }
    catch (e) { out.push({ site: c.site, ok: false, detail: e instanceof Error ? e.message : String(e) }); }
  }
  return out;
}

/** Checks every repository of every client against its checksums. The report is read because pgBackRest exits 0 even when it finds damage. */
export async function verifyAll(clients: CloudClient[], r: Runner): Promise<JobResult[]> {
  const out: JobResult[] = [];
  for (const c of clients) {
    try {
      const env = await envFor(c);
      for (let repo = 1; repo <= c.repoCount; repo++) {
        const res = await r.run('pgbackrest', [`--config=${c.configFile}`, `--stanza=${c.stanza}`, `--repo=${repo}`, '--log-level-console=info', 'verify'], { env, timeoutMs: 3_600_000 });
        const text = `${res.stdout}\n${res.stderr}`;
        if (/status:\s*error/i.test(text) || !/verify command end: completed successfully/i.test(text)) throw new Error(`repository ${repo}: ${text.split('stanza:')[1]?.trim() ?? text.trim().slice(-300)}`);
      }
      out.push({ site: c.site, ok: true, detail: `${c.repoCount} repositories verified` });
    } catch (e) { out.push({ site: c.site, ok: false, detail: e instanceof Error ? e.message : String(e) }); }
  }
  return out;
}

/** The clients whose restore test is due this month: a fixed rotation, so every client is tested in turn and the choice does not change between runs. */
export function sampleFor(clients: CloudClient[], monthIndex: number, perMonth: number): CloudClient[] {
  if (clients.length === 0 || perMonth <= 0) return [];
  const sorted = [...clients].sort((a, b) => a.site.localeCompare(b.site));
  const n = Math.min(perMonth, sorted.length);
  return Array.from({ length: n }, (_, i) => sorted[(monthIndex * n + i) % sorted.length] as CloudClient);
}

/** Runs the restore test for each client in the sample, one scratch database at a time. `portsFor` builds the scratch machine for a client (with its key in the environment). */
export async function restoreTests(sample: CloudClient[], portsFor: (c: CloudClient) => Promise<ScratchPorts>, dir: (c: CloudClient) => string): Promise<(JobResult & { report: RestoreTestReport })[]> {
  const out: (JobResult & { report: RestoreTestReport })[] = [];
  for (const c of sample) {
    let report: RestoreTestReport;
    try { report = await runRestoreTest(await portsFor(c), dir(c)); } catch (e) { report = { ok: false, startedAt: new Date().toISOString(), seconds: 0, checks: [], error: e instanceof Error ? e.message : String(e) }; }
    out.push({ site: c.site, ok: report.ok, detail: report.ok ? `${report.checks.length} checks passed in ${report.seconds}s` : report.error ?? report.checks.filter((k) => !k.ok).map((k) => `${k.name}: ${k.detail}`).join('; '), report });
  }
  return out;
}
