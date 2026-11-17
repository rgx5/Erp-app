import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import pg from 'pg'

const BACKEND = resolve(process.cwd(), '../backend')
const ADMIN = process.env['TEST_PG_ADMIN_URL'] ?? 'postgresql://postgres@localhost:5434/postgres'
const PLATFORM_TOKEN = 'live-test-platform-token-live-test-platform-token'

const freePort = (): Promise<number> => new Promise((ok, fail) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)) }); s.on('error', fail) })
const run = (cmd: string, args: string[], env: Record<string, string>): Promise<void> => new Promise((ok, fail) => {
  const child = spawn(cmd, args, { cwd: BACKEND, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(' ')} failed:\n${out}`))))
})
const urlFor = (base: string, user: string | undefined, password: string | undefined, db: string): string => { const u = new URL(base); if (user) { u.username = user; u.password = password ?? '' } u.pathname = `/${db}`; return u.toString() }

/** Boots the real backend against a scratch PostgreSQL database; `stop` tears both down. */
export async function bootBackend(): Promise<{ baseUrl: string; platformToken: string; stop: () => Promise<void> }> {
  const dbName = `client_live_${process.pid}_${Date.now().toString(36)}`
  const admin = new pg.Client({ connectionString: ADMIN })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${dbName}`)
  const adminDb = urlFor(ADMIN, undefined, undefined, dbName)
  await run('npx', ['tsx', 'scripts/bootstrap-db.ts'], { ADMIN_DATABASE_URL: adminDb, MIGRATOR_PASSWORD: 'live-migrator', APP_PASSWORD: 'live-app' })
  await run('npx', ['tsx', 'src/db/cli.ts', 'up'], { MIGRATOR_DATABASE_URL: urlFor(ADMIN, 'erp_migrator', 'live-migrator', dbName) })

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const server: ChildProcess = spawn('npx', ['tsx', 'src/main.ts'], {
    cwd: BACKEND, stdio: 'ignore',
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'silent', DATABASE_URL: urlFor(ADMIN, 'erp_app', 'live-app', dbName), PLATFORM_ADMIN_TOKEN: PLATFORM_TOKEN, CORS_ALLOWED_ORIGINS: 'app://onesync,http://localhost:5173', SELF_SIGNUP_ENABLED: 'false' },
    detached: true,
  })
  const deadline = Date.now() + 90_000
  for (;;) {
    try { if ((await fetch(`${baseUrl}/health/live`)).ok) break } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('The backend did not start in time')
    await new Promise((r) => setTimeout(r, 300))
  }

  return { baseUrl, platformToken: PLATFORM_TOKEN, stop: async () => {
    try { process.kill(-(server.pid as number)) } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 500))
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
    await admin.end()
  } }
}
