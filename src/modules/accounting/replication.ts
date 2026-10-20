import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerCollectionMeta } from '@/replication/registry'
import type { Doc, DocStore } from '@/replication/types'
import { LOCKED_MESSAGE, voucherProblem } from './logic'
import type { Voucher } from './types'
import './types'

registerCollections(['accounts', 'vouchers', 'financialYears', 'periodLocks'])

// The books are for the owner and managers; locking a period or closing a year is the owner's alone.
registerPermission('accounting', ['manager'])
registerPermission('accountingLock', [])

/** The last locked day, read from the server's own documents (a phone's clock or copy of the locks is not trusted). */
async function lockedThroughIn(db: DocStore): Promise<number | null> {
  let max: number | null = null
  let since = 0
  for (;;) {
    const page = await db.changesSince(since, 500, { colls: ['periodLocks'], branches: 'all' })
    for (const d of page.docs) {
      const t = d.data && typeof d.data.throughDate === 'number' ? d.data.throughDate : null
      if (t !== null && (max === null || t > max)) max = t
    }
    if (!page.hasMore) return max
    since = page.cursor
  }
}

/** A voucher dated inside a locked period is refused by the server, whatever the phone says. */
export async function voucherLockProblem(doc: Doc, db: DocStore): Promise<string | null> {
  const date = (doc as { date?: unknown }).date
  if (typeof date !== 'number' || !Number.isFinite(date)) return 'A voucher needs a date'
  const locked = await lockedThroughIn(db)
  return locked !== null && date <= locked ? LOCKED_MESSAGE : null
}

registerCollectionMeta(
  { name: 'accounts', kind: 'master', perm: 'accounting', readPerm: 'accounting' },
  {
    name: 'vouchers', kind: 'ledger', perm: 'accounting', readPerm: 'accounting', branched: true,
    validate: (d) => (Array.isArray(d.lines) ? voucherProblem((d as unknown as Voucher).lines) : 'A voucher needs its lines'),
    guard: voucherLockProblem,
  },
  { name: 'financialYears', kind: 'master', perm: 'accountingLock', readPerm: 'accounting' },
  { name: 'periodLocks', kind: 'master', perm: 'accountingLock', readPerm: 'accounting' },
)
