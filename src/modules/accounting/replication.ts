import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerCollectionMeta } from '@/replication/registry'
import { voucherProblem } from './logic'
import type { Voucher } from './types'
import './types'

registerCollections(['accounts', 'vouchers', 'financialYears', 'periodLocks'])

// The books are for the owner and managers; locking a period or closing a year is the owner's alone.
registerPermission('accounting', ['manager'])
registerPermission('accountingLock', [])

registerCollectionMeta(
  { name: 'accounts', kind: 'master', perm: 'accounting', readPerm: 'accounting' },
  {
    name: 'vouchers', kind: 'ledger', perm: 'accounting', readPerm: 'accounting', branched: true,
    validate: (d) => (Array.isArray(d.lines) ? voucherProblem((d as unknown as Voucher).lines) : 'A voucher needs its lines'),
  },
  { name: 'financialYears', kind: 'master', perm: 'accountingLock', readPerm: 'accounting' },
  { name: 'periodLocks', kind: 'master', perm: 'accountingLock', readPerm: 'accounting' },
)
