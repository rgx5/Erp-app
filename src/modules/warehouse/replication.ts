import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerPostingRule } from '@/modules/postings'
import { addEffects, registerCollectionMeta } from '@/replication/registry'
import { batchEffects, levelEffects } from './logic'
import type { BatchMove, TransferReceipt, WriteOff } from './types'
import { transferLossPosting, writeOffPosting } from './posting'
import './types'

/**
 * Collections of the warehouse module. Registration order matters:
 *   • `batchMoves` comes BEFORE `batches` and `stockLevels` comes after the core `moves`, because the server builds those two
 *     from the movements (an effect creates the batch / the level with its quantity). A phone also sends the batch it created
 *     locally; if that arrives second, the server keeps the quantity it computed (owned fields are never overwritten).
 */
registerCollections(['locations', 'itemRules', 'unitConversions', 'bundles', 'batchMoves', 'batches', 'serials', 'stockLevels', 'transfers', 'transferReceipts', 'writeOffs'])

registerPermission('warehouse', ['manager'])

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const WAREHOUSE = ['warehouse', 'stock']
/** People at the counter and on the goods-receipt screen write batches, serials and movements through the sell / receive hooks. */
const FLOOR = ['warehouse', 'stock', 'pos', 'purchases', 'inventory']

registerCollectionMeta(
  // Locations and transfers are visible to every branch: a transfer between two stores has to be seen by both.
  { name: 'locations', kind: 'master', perm: 'warehouse', readPerm: 'any' },
  { name: 'itemRules', kind: 'master', perm: 'warehouse', readPerm: 'any' },
  { name: 'unitConversions', kind: 'master', perm: 'warehouse', readPerm: 'any' },
  { name: 'bundles', kind: 'master', perm: 'warehouse', readPerm: 'any' },
  {
    name: 'batchMoves', kind: 'ledger', perm: FLOOR, readPerm: 'any',
    validate: (d) => (typeof d.batchId === 'string' && typeof d.variantId === 'string' && finite(d.qty) ? null : 'A batch movement needs a batch, an item and a quantity'),
    effects: (d) => batchEffects(d as unknown as BatchMove),
  },
  { name: 'batches', kind: 'master', perm: FLOOR, readPerm: 'any', owned: ['qty'] },
  { name: 'serials', kind: 'master', perm: FLOOR, readPerm: 'any' },
  { name: 'stockLevels', kind: 'master', perm: FLOOR, readPerm: WAREHOUSE.concat('pos'), owned: ['qty'] },
  {
    name: 'transfers', kind: 'ledger', perm: WAREHOUSE, readPerm: WAREHOUSE,
    validate: (d) => (Array.isArray(d.lines) && d.lines.length && typeof d.fromId === 'string' && typeof d.toId === 'string' && d.fromId !== d.toId ? null : 'A transfer needs two different places and its lines'),
  },
  {
    name: 'transferReceipts', kind: 'ledger', perm: WAREHOUSE, readPerm: WAREHOUSE,
    validate: (d) => (typeof d.transferId === 'string' && Array.isArray(d.lines) ? null : 'A receipt needs its transfer and the lines that arrived'),
  },
  {
    name: 'writeOffs', kind: 'ledger', perm: WAREHOUSE, readPerm: WAREHOUSE, branched: true,
    validate: (d) => (Array.isArray(d.lines) && d.lines.length ? null : 'A write-off needs its lines'),
  },
)

// A stock movement that names a location changes that location's level (the core effect keeps the total).
addEffects('moves', (doc) => levelEffects(doc as unknown as Parameters<typeof levelEffects>[0]))
// (`batches.qty` and `stockLevels.qty` are declared `owned` on their collections above; the server alone changes them.)

// What a write-off means to the books: the cost of the stock written off leaves the inventory account.
registerPostingRule('writeOffs', (d) => writeOffPosting(d as unknown as WriteOff))
registerPostingRule('transferReceipts', (d) => transferLossPosting(d as unknown as TransferReceipt))
