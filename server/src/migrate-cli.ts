import { loadConfig } from './config'
import { createPool } from './db'
import { migrate } from './migrate'

async function main() {
  const cfg = loadConfig()
  const pool = createPool(cfg.databaseUrl, 2)
  try {
    const done = await migrate(pool, undefined, (m) => console.log(m))
    console.log(done.length ? `applied ${done.length} migration(s)` : 'migrations up to date')
  } finally {
    await pool.end()
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
