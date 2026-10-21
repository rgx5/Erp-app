import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { registerPostingRule } from '@/modules/postings'
import { registerCollectionMeta } from '@/replication/registry'
import { productionPosting } from './posting'
import type { ProductionEntry } from './types'
import './types'

/**
 * Collections of the manufacturing module. Stock itself is not kept here: issuing material and receiving goods post ordinary stock
 * movements (`moves`), so item totals stay right on the server and the phone through the core effect (and the warehouse's, for
 * locations). The production entries and quality checks are posted once and never edited; recipes, work orders and jobs are
 * editable masters.
 */
registerCollections(['recipes', 'workOrders', 'productionEntries', 'qualityChecks', 'jobOrders'])

/** Recipes and costs are the manager's; the floor (stock keepers) runs work orders; the counter takes customer jobs. */
registerPermission('manufacturing', ['manager'])

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const one = (v: unknown, list: string[]) => typeof v === 'string' && list.includes(v)
const FLOOR = ['manufacturing', 'inventory']

registerCollectionMeta(
  {
    name: 'recipes', kind: 'master', perm: 'manufacturing', readPerm: FLOOR,
    validate: (d) => (typeof d.outputVariantId === 'string' && Array.isArray(d.lines) && d.lines.length && finite(d.outputQty) && (d.outputQty as number) > 0 ? null : 'A recipe needs the item it makes, a batch size and its ingredients'),
  },
  {
    name: 'workOrders', kind: 'master', perm: FLOOR, branched: true,
    validate: (d) => (typeof d.recipeId === 'string' && Array.isArray(d.lines) && finite(d.qty) && (d.qty as number) > 0 && one(d.status, ['planned', 'in_progress', 'done', 'cancelled']) ? null : 'A work order needs a recipe, a quantity, its lines and a status'),
  },
  {
    name: 'productionEntries', kind: 'ledger', perm: FLOOR, branched: true,
    validate: (d) => (typeof d.workOrderId === 'string' && one(d.kind, ['issue', 'return', 'receipt', 'close']) && Array.isArray(d.lines) ? null : 'A production entry needs its work order, a kind and its lines'),
  },
  {
    name: 'qualityChecks', kind: 'ledger', perm: FLOOR, branched: true,
    validate: (d) => (typeof d.workOrderId === 'string' && Array.isArray(d.results) && finite(d.qtyChecked) && (d.qtyChecked as number) > 0 ? null : 'An inspection needs its work order, its results and how many units were checked'),
  },
  {
    name: 'jobOrders', kind: 'master', perm: ['manufacturing', 'pos'], branched: true,
    validate: (d) => (typeof d.customerId === 'string' && one(d.kind, ['made_to_order', 'job_work']) && typeof d.title === 'string' ? null : 'A job needs a customer, a kind and a description'),
  },
)

// What production means to the books: materials into work in progress, finished goods out of it, losses as expense.
registerPostingRule<ProductionEntry>('productionEntries', (e) => productionPosting(e))
