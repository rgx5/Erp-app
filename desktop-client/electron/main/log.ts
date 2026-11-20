import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const MAX = 1_000_000
export const logDir = (): string => join(app.getPath('userData'), 'logs')

/** A plain text log of what went wrong, kept in the user's data folder so support can ask for it. Never holds business data or passwords. */
export function log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  try {
    const dir = logDir(); mkdirSync(dir, { recursive: true })
    const file = join(dir, 'main.log')
    try { if (statSync(file).size > MAX) renameSync(file, join(dir, 'main.old.log')) } catch { /* no log yet */ }
    const extra = detail instanceof Error ? `${detail.message}\n${detail.stack ?? ''}` : detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)
    appendFileSync(file, `${new Date().toISOString()} ${level.toUpperCase()} ${message}${extra ? ` ${extra}` : ''}\n`)
  } catch { /* logging must never break the app */ }
}
