import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerCollectionMeta } from '@/replication/registry'
import './types'
import './postings'

registerCollections(['quotations', 'salesOrders', 'orderPayments', 'challans', 'subscriptions', 'commissionRules', 'salesTargets', 'shifts', 'cashMoves'])

/** Recurring billing, commission rules and targets are the manager's; the counter staff make quotes, orders, challans and shifts. */
registerPermission('salesDocs', ['manager'])

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const hasItems = (d: Record<string, unknown>) => Array.isArray(d.items) && d.items.length > 0

registerCollectionMeta(
  { name: 'quotations', kind: 'master', perm: 'pos', branched: true, validate: (d) => (hasItems(d) && typeof d.no === 'string' ? null : 'A quotation needs a number and its lines') },
  { name: 'salesOrders', kind: 'master', perm: 'pos', branched: true, validate: (d) => (hasItems(d) && typeof d.customerId === 'string' ? null : 'A sales order needs a customer and its lines') },
  {
    name: 'orderPayments', kind: 'ledger', perm: 'pos', branched: true,
    validate: (d) => (typeof d.orderId === 'string' && finite(d.amount) && (d.amount as number) > 0 && ['advance', 'refund', 'applied'].includes(String(d.kind)) ? null : 'An order payment needs an order, a kind and a positive amount'),
  },
  { name: 'challans', kind: 'master', perm: 'pos', branched: true, validate: (d) => (Array.isArray(d.items) ? null : 'A challan needs its lines') },
  { name: 'subscriptions', kind: 'master', perm: 'salesDocs', branched: true, validate: (d) => (hasItems(d) && ['monthly', 'quarterly', 'yearly'].includes(String(d.frequency)) ? null : 'A subscription needs lines and a frequency') },
  { name: 'commissionRules', kind: 'master', perm: 'salesDocs', validate: (d) => (finite(d.rate) && (d.rate as number) >= 0 ? null : 'A commission rate cannot be negative') },
  { name: 'salesTargets', kind: 'master', perm: 'salesDocs', validate: (d) => (typeof d.staffId === 'string' && finite(d.amount) ? null : 'A target needs a person and an amount') },
  { name: 'shifts', kind: 'master', perm: 'pos', branched: true, validate: (d) => (finite(d.openingCash) && (d.openingCash as number) >= 0 ? null : 'Opening cash cannot be negative') },
  {
    name: 'cashMoves', kind: 'ledger', perm: 'pos', branched: true,
    validate: (d) => (typeof d.shiftId === 'string' && finite(d.amount) && (d.amount as number) > 0 && (d.kind === 'in' || d.kind === 'out') ? null : 'Cash in/out needs a shift, a direction and a positive amount'),
  },
)
