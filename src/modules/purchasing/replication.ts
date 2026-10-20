import { registerCollections } from '@/data/state'
import type { Purchase } from '@/domain/types'
import { addEffects, registerCollectionMeta } from '@/replication/registry'
import { orderAfterReceipt } from './logic'
import type { PurchaseOrder } from './types'
import './types'

registerCollections(['purchaseOrders'])
registerCollectionMeta({
  name: 'purchaseOrders', kind: 'master', perm: 'purchases', branched: true,
  validate: (d) => (Array.isArray(d.items) && typeof d.supplierId === 'string' ? null : 'A purchase order needs a supplier and its lines'),
})

// A goods receipt that names an order updates it — on the phone and on the server, by the same function.
addEffects('purchases', (doc) => {
  const receipt = doc as unknown as Purchase
  return receipt.poId ? [{ kind: 'update', coll: 'purchaseOrders', id: receipt.poId, fn: (po) => orderAfterReceipt(po as unknown as PurchaseOrder, receipt) }] : []
})
