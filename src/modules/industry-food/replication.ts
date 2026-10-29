// Pure half of the industry-food module: collections, permissions, validation. See docs/MODULES.md.
import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerCollectionMeta } from '@/replication/registry'
import './types'
import './postings'

/**
 * Who may do what.
 *   food        the floor and counter: open/settle tables and orders, send KOTs, collect tips, run deliveries
 *   foodManage  the set-up: tables, modifier groups, pack → loose rules
 */
registerPermission('food', ['manager', 'cashier'])
registerPermission('foodManage', ['manager'])

registerCollections(['foodTables', 'foodModifierGroups', 'foodOrders', 'foodKots', 'foodTips', 'foodLooseRules', 'foodDeliveries'])

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const str = (v: unknown) => typeof v === 'string' && v.trim().length > 0
const oneOf = (v: unknown, list: string[]) => typeof v === 'string' && list.includes(v)
const arr = (v: unknown) => Array.isArray(v)
const COUNTER = ['food', 'foodManage', 'reports']
const MANAGE = 'foodManage'

registerCollectionMeta(
  { name: 'foodTables', kind: 'master', perm: MANAGE, readPerm: COUNTER, validate: (d) => (str(d.no) && finite(d.seats) && (d.seats as number) > 0 ? null : 'A table needs a number and a seat count') },
  {
    name: 'foodModifierGroups', kind: 'master', perm: MANAGE, readPerm: COUNTER,
    validate: (d) => (str(d.name) && arr(d.options) && (d.options as unknown[]).length > 0 && finite(d.min) && finite(d.max) ? null : 'A modifier group needs a name and at least one option'),
  },
  {
    name: 'foodOrders', kind: 'master', perm: 'food', readPerm: COUNTER, branched: true,
    validate: (d) => (str(d.no) && oneOf(d.kind, ['dine_in', 'takeaway', 'delivery']) && oneOf(d.status, ['open', 'billed', 'cancelled']) && arr(d.tableIds) && arr(d.lines) && finite(d.openedAt)
      ? null : 'An order needs a number, a kind and its lines'),
  },
  {
    name: 'foodKots', kind: 'ledger', perm: 'food', readPerm: COUNTER, branched: true,
    validate: (d) => (str(d.no) && str(d.orderId) && str(d.station) && arr(d.lines) && finite(d.createdAt) ? null : 'A kitchen ticket needs an order, a station and its lines'),
  },
  {
    name: 'foodTips', kind: 'ledger', perm: 'food', readPerm: COUNTER, branched: true,
    validate: (d) => (finite(d.amount) && (d.amount as number) > 0 && oneOf(d.mode, ['cash', 'upi', 'card']) && finite(d.date) ? null : 'A tip needs an amount and how it was paid'),
  },
  {
    name: 'foodLooseRules', kind: 'master', perm: MANAGE, readPerm: COUNTER,
    validate: (d) => (finite(d.packSizeG) && (d.packSizeG as number) > 0 && finite(d.minG) && (d.minG as number) > 0 && oneOf(d.unitLabel, ['g', 'ml']) ? null : 'A rule needs the pack size and the smallest loose amount'),
  },
  {
    name: 'foodDeliveries', kind: 'master', perm: 'food', readPerm: COUNTER, branched: true,
    validate: (d) => (str(d.no) && str(d.partyName) && str(d.address) && arr(d.lines) && oneOf(d.status, ['placed', 'out', 'delivered', 'cancelled']) && finite(d.placedAt)
      ? null : 'A delivery needs a name, an address and its items'),
  },
)
