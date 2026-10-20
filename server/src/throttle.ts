import type { Pool } from 'pg'
import { lockoutSeconds } from './passwords'

/** Seconds until another attempt is allowed for this key (0 = free to try). */
export async function lockedFor(pool: Pool, key: string): Promise<number> {
  const r = await pool.query<{ locked_until: number }>('SELECT locked_until FROM login_throttle WHERE key = $1', [key])
  const until = r.rows[0]?.locked_until ?? 0
  return Math.max(0, Math.ceil((until - Date.now()) / 1000))
}

/** Counts a failure and starts (or lengthens) the lockout. Returns the seconds now locked for. */
export async function recordFailure(pool: Pool, key: string): Promise<number> {
  const r = await pool.query<{ fails: number }>(
    `INSERT INTO login_throttle (key, fails, updated_at) VALUES ($1, 1, now())
     ON CONFLICT (key) DO UPDATE SET fails = login_throttle.fails + 1, updated_at = now() RETURNING fails`, [key])
  const wait = lockoutSeconds(r.rows[0].fails)
  if (wait) await pool.query('UPDATE login_throttle SET locked_until = $2 WHERE key = $1', [key, Date.now() + wait * 1000])
  return wait
}

export const clearThrottle = (pool: Pool, key: string) => pool.query('DELETE FROM login_throttle WHERE key = $1', [key])
