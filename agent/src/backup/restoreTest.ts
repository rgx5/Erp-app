/** What a restore test needs from the machine it runs on. */
export interface ScratchPorts {
  /** Restores the newest (or the named) backup into a fresh scratch directory. */
  restoreInto(dir: string, o: { backup?: string; time?: string }): Promise<void>;
  /** Starts a throwaway database on the restored files with archiving OFF (so it can never write into the real repository), and waits until it accepts queries. */
  start(dir: string): Promise<void>;
  query(sql: string): Promise<string>;
  stop(): Promise<void>;
  cleanup(dir: string): Promise<void>;
}
export interface Check { name: string; sql: string; expect: (result: string) => boolean | string }
export interface RestoreTestReport { ok: boolean; startedAt: string; seconds: number; checks: { name: string; ok: boolean; detail: string }[]; error?: string }

/** Checks every restored OneSyncERP database must pass: it opens, and the books balance. Add more for a client with their own. */
export const ERP_CHECKS: Check[] = [
  { name: 'database opens', sql: 'SELECT 1', expect: (r) => r.trim() === '1' },
  { name: 'migrations table present', sql: "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'erp'", expect: (r) => Number(r) > 0 || 'no erp tables: this is not a OneSyncERP database' },
  { name: 'ledger balances (debits equal credits)', sql: "SELECT CASE WHEN to_regclass('erp.journal_lines') IS NULL THEN 'none' ELSE (SELECT (coalesce(sum(debit),0) = coalesce(sum(credit),0))::text FROM erp.journal_lines) END", expect: (r) => r.trim() === 'none' || r.trim() === 'true' || 'debits and credits differ' },
];

/** Restores a backup into a scratch place, opens it, runs the checks, and cleans up. Never touches the live database or the repository's contents. */
export async function runRestoreTest(ports: ScratchPorts, dir: string, o: { backup?: string; time?: string; checks?: Check[]; now?: () => Date } = {}): Promise<RestoreTestReport> {
  const started = (o.now ?? (() => new Date()))();
  const checks: RestoreTestReport['checks'] = [];
  let error: string | undefined;
  try {
    await ports.restoreInto(dir, { ...(o.backup ? { backup: o.backup } : {}), ...(o.time ? { time: o.time } : {}) });
    await ports.start(dir);
    for (const c of o.checks ?? ERP_CHECKS) {
      try {
        const result = (await ports.query(c.sql)).trim();
        const verdict = c.expect(result);
        checks.push({ name: c.name, ok: verdict === true, detail: verdict === true ? result : typeof verdict === 'string' ? verdict : `unexpected result: ${result}` });
      } catch (e) { checks.push({ name: c.name, ok: false, detail: e instanceof Error ? e.message : String(e) }); }
    }
  } catch (e) { error = e instanceof Error ? e.message : String(e); }
  finally { await ports.stop().catch(() => undefined); await ports.cleanup(dir).catch(() => undefined); }
  return { ok: !error && checks.length > 0 && checks.every((c) => c.ok), startedAt: started.toISOString(), seconds: Math.round(((o.now ?? (() => new Date()))().getTime() - started.getTime()) / 1000), checks, ...(error ? { error } : {}) };
}
