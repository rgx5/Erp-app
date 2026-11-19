/** What recovering a site's database needs from the machine. */
export interface SiteControl {
  stopApp(): Promise<void>;
  stopDatabase(): Promise<void>;
  /** Restores from the repository over the (stopped) database directory; resolves when the files are in place. */
  restore(o: { backup?: string; time?: string; repo?: number }): Promise<void>;
  startDatabase(): Promise<void>;
  /** Waits until the database has finished recovery and accepts writes. Rejects when it does not. */
  waitDatabaseReady(): Promise<void>;
  startApp(): Promise<void>;
  appHealthy(): Promise<boolean>;
}
export interface RestoreSiteResult { ok: boolean; steps: string[]; error?: string }

/**
 * Brings a site's database back from the repository: stop the application (nobody may write), stop the database, restore, start the
 * database and wait for recovery, then start the application and check it. If anything fails, the application stays stopped so no one
 * works on a half-restored database; the result says where it stopped.
 */
export async function restoreSite(c: SiteControl, o: { backup?: string; time?: string; repo?: number } = {}): Promise<RestoreSiteResult> {
  const steps: string[] = [];
  const step = async (name: string, fn: () => Promise<void>): Promise<void> => { steps.push(name); await fn(); };
  try {
    await step('stop application', () => c.stopApp());
    await step('stop database', () => c.stopDatabase());
    await step('restore', () => c.restore(o));
    await step('start database', () => c.startDatabase());
    await step('wait for recovery', () => c.waitDatabaseReady());
    await step('start application', () => c.startApp());
    steps.push('check application');
    if (!(await c.appHealthy())) throw new Error('The application is not healthy after the restore');
    return { ok: true, steps };
  } catch (e) {
    return { ok: false, steps, error: e instanceof Error ? e.message : String(e) };
  }
}
