/**
 * Warehouse — registration of what this module adds to the app: locations and transfers, batches and expiry, serial numbers and
 * warranty, bigger units, kits and write-offs (all on the Inventory app), plus the sell / receive / return hooks that keep
 * batches, serials and locations right in the same transaction as the bill or the goods receipt.
 *   replication.ts  collections, permissions, effects, posting rules (pure; the server loads it too)
 *   logic.ts / flow.ts / ops.ts / hooks.ts / posting.ts  rules and operations (pure; tested)
 *   src/app/m/warehouse/…  its screens
 */
import { listOf } from '@/data/state'
import { ArrowLeftRight, Boxes, Hourglass, Layers, Package, PackageSearch, Scale, Sliders, Trash, Warehouse } from '@/ui/icons'
import { registerModule, registerBillHook, registerCartAdjuster, registerPanel, registerReceiptExtra, registerReceiptHook, registerReturnHook } from '../registry'
import { openTransfers, expirySummary } from './logic'
import { billHook, packAdjuster, receiptExtra, receiptHook, returnHook } from './hooks'
import { BillPanel, ItemPanel, LinePanel, ReceiptPanel } from './ui/panels'
import './replication'

registerModule({
  id: 'inventory', name: 'Inventory', tagline: 'Items, stock, locations and batches', icon: Boxes, tone: 'accent', order: 20,
  features: [
    { id: 'wh-locations', label: 'Locations', sub: 'Godowns, shelves and stock in each', icon: Warehouse, tone: 'primary', to: '/m/warehouse/locations', perm: 'warehouse', section: 'Locations & transfers' },
    { id: 'wh-transfers', label: 'Stock transfers', sub: 'Send stock between places; in transit → received', icon: ArrowLeftRight, tone: 'accent', to: '/m/warehouse/transfers', perm: 'warehouse', section: 'Locations & transfers',
      badge: (s) => openTransfers(s).length || null },
    { id: 'wh-batches', label: 'Batches', sub: 'Batch numbers, quantities and expiry dates', icon: Layers, tone: 'success', to: '/m/warehouse/batches', perm: 'stock', section: 'Batches & serials' },
    { id: 'wh-expiry', label: 'Expiry', sub: 'Expired and expiring soon', icon: Hourglass, tone: 'warning', to: '/m/warehouse/batches/expiry', perm: 'stock', section: 'Batches & serials',
      badge: (s) => { const x = expirySummary(s, Date.now()); return x.expired + x.soon || null } },
    { id: 'wh-serials', label: 'Serial numbers', sub: 'IMEI / serial look-up and warranty', icon: PackageSearch, tone: 'primary', to: '/m/warehouse/serials', perm: 'pos', section: 'Batches & serials' },
    { id: 'wh-tracking', label: 'Tracking rules', sub: 'Which items need a batch or serial number', icon: Sliders, tone: 'default', to: '/m/warehouse/tracking', perm: 'warehouse', section: 'Batches & serials' },
    { id: 'wh-units', label: 'Bigger units', sub: 'Box ↔ piece, carton ↔ strip, pack prices', icon: Scale, tone: 'accent', to: '/m/warehouse/units', perm: 'warehouse', section: 'Units & kits' },
    { id: 'wh-bundles', label: 'Kits & combos', sub: 'Sell several items as one', icon: Package, tone: 'success', to: '/m/warehouse/bundles', perm: 'warehouse', section: 'Units & kits' },
    { id: 'wh-writeoffs', label: 'Write-offs', sub: 'Damage, expiry disposal, samples', icon: Trash, tone: 'danger', to: '/m/warehouse/writeoffs', perm: 'warehouse', section: 'Losses' },
  ],
  reports: [
    { id: 'wh-r-expiry', label: 'Expiry report', sub: 'Stock past or near its date, with value', icon: Hourglass, tone: 'warning', to: '/m/warehouse/batches/expiry', group: 'Stock', perm: 'stock' },
    { id: 'wh-r-batches', label: 'Batch-wise stock', sub: 'Every batch with stock, soonest expiry first', icon: Layers, tone: 'success', to: '/m/warehouse/batches', group: 'Stock', perm: 'stock' },
    { id: 'wh-r-locations', label: 'Stock by location', sub: 'Items, units and value in each place', icon: Warehouse, tone: 'primary', to: '/m/warehouse/locations', group: 'Stock', perm: 'warehouse' },
    { id: 'wh-r-transit', label: 'Stock in transit', sub: 'Transfers sent and not yet received', icon: ArrowLeftRight, tone: 'accent', to: '/m/warehouse/transfers', group: 'Stock', perm: 'warehouse' },
    { id: 'wh-r-losses', label: 'Write-off losses', sub: 'Damage, expiry and samples at cost', icon: Trash, tone: 'danger', to: '/m/warehouse/writeoffs', group: 'Stock', perm: 'warehouse' },
  ],
  notices: [
    (s, now) => {
      if (!listOf(s.batches).length) return null
      const x = expirySummary(s, now)
      if (!x.expired && !x.soon) return null
      return {
        id: 'wh-expiry', tone: x.expired ? 'danger' : 'warning',
        title: x.expired ? `${x.expired} ${x.expired === 1 ? 'batch has' : 'batches have'} expired` : `${x.soon} ${x.soon === 1 ? 'batch expires' : 'batches expire'} within 30 days`,
        body: `${x.expired && x.soon ? `${x.soon} more expire soon · ` : ''}stock at risk ₹${Math.round(x.value).toLocaleString('en-IN')}`, action: 'Review', to: '/m/warehouse/batches/expiry',
      }
    },
    (s) => {
      const open = openTransfers(s)
      return open.length ? { id: 'wh-transit', tone: 'accent', title: `${open.length} ${open.length === 1 ? 'transfer is' : 'transfers are'} on the way`, body: 'Receive them when they arrive', action: 'Open', to: '/m/warehouse/transfers' } : null
    },
  ],
})

registerPanel({ id: 'warehouse.item', slot: 'item', order: 30, perm: 'stock', needsKosh: true, component: ItemPanel })
registerPanel({ id: 'warehouse.line', slot: 'line', order: 30, perm: 'pos', needsKosh: true, component: LinePanel })
registerPanel({ id: 'warehouse.receipt', slot: 'receipt', order: 30, perm: 'purchases', needsKosh: true, component: ReceiptPanel })
registerPanel({ id: 'warehouse.bill', slot: 'bill', order: 30, perm: 'pos', needsKosh: true, component: BillPanel })

registerBillHook(billHook)
registerReceiptHook(receiptHook)
registerReturnHook(returnHook)
registerCartAdjuster(packAdjuster)
registerReceiptExtra(receiptExtra)
