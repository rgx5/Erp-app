import { buildApp } from './app'
import { loadConfig } from './config'
import { createPool } from './db'
import { migrate } from './migrate'

async function main() {
  const cfg = loadConfig()
  const pool = createPool(cfg.databaseUrl)
  // Migrations are idempotent and serialised by an advisory lock, so every instance may run them at start.
  if (process.env.MIGRATE_ON_START !== '0') await migrate(pool, undefined, (m) => console.log(m))
  const app = buildApp({ cfg, pool })
  await app.listen({ port: cfg.port, host: cfg.host })
  console.log(`Kosh Server listening on :${cfg.port}`)
  const stop = async () => { await app.close(); await pool.end(); process.exit(0) }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
