import type { OpCtx } from '@/data/ops'
import { pad } from '@/domain/ids'

/**
 * The next document number in a series, e.g. `nextNo('QT-', existing, ctx)` → `QT-0042`, or `QT-M4X-0001` on a connected phone
 * (each phone numbers from its own series so two devices can never issue the same number). `existing` is every number already
 * used in this series — from any device.
 */
export function nextNo(prefix: string, existing: string[], ctx: Pick<OpCtx, 'series'>, width = 4): string {
  const full = `${prefix}${ctx.series ? `${ctx.series}-` : ''}`
  let max = 0
  for (const n of existing) {
    if (!n.startsWith(full)) continue
    const m = /^(\d+)$/.exec(n.slice(full.length))
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `${full}${pad(max + 1, width)}`
}
