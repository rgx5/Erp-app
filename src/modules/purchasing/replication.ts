import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import type { Purchase } from '@/domain/types'
import { addEffects, addOwnedFields, registerCollectionMeta, type Effect } from '@/replication/registry'
import { orderAfterApproval } from './approvals'
import { orderAfterReceipt } from './logic'
import type { LandedCost, PoApproval, PurchaseInvoice, PurchaseOrder, PurchaseReturn, SupplierPayment } from './types'
import './types'
import './postings'

// Managers approve orders (up to the limit the owner sets); the owner always can. Purchasing settings are the owner's.
registerPermission('approvePurchases', ['manager'])

registerCollections(['purchaseOrders', 'poApprovals', 'purchaseSettings', 'supplierTerms', 'supplierPayments', 'purchaseInvoices', 'purchaseReturns', 'landedCosts', 'supplierPrices', 'rfqs', 'rfqQuotes'])

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
const positive = (n: unknown) => finite(n) && (n as number) > 0
const str = (v: unknown) => typeof v === 'string' && v.length > 0
// Who needs to see what: the purchasing screens, and the reports that add it up.
const READ = ['purchases', 'reports']

registerCollectionMeta(
  {
    // The approval fields are the server's: a client cannot grant itself an approval by patching them.
    name: 'purchaseOrders', kind: 'master', perm: 'purchases', branched: true,
    owned: ['approvalStatus', 'approvedAmount', 'approvedBy', 'approvedAt'],
    validate: (d) => (Array.isArray(d.items) && typeof d.supplierId === 'string' ? null : 'A purchase order needs a supplier and its lines'),
  },
  {
    name: 'poApprovals', kind: 'ledger', perm: 'approvePurchases', readPerm: READ, branched: true,
    validate: (d) => (str(d.orderId) && (d.decision === 'approved' || d.decision === 'rejected') && positive(d.amount) ? null : 'An approval needs an order, a decision and the amount'),
    effects: (d) => [{ kind: 'update', coll: 'purchaseOrders', id: (d as unknown as PoApproval).orderId, fn: () => orderAfterApproval(d as unknown as PoApproval) }],
  },
  { name: 'purchaseSettings', kind: 'master', perm: 'settings', readPerm: READ },
  { name: 'supplierTerms', kind: 'master', perm: 'purchases', readPerm: READ },
  {
    name: 'supplierPayments', kind: 'ledger', perm: 'purchases', readPerm: READ, branched: true,
    validate: (d) => (str(d.supplierId) && positive(d.amount) && Array.isArray(d.allocations) ? null : 'A payment needs a supplier, an amount and its allocations'),
    effects: (d) => paymentEffects(d as unknown as SupplierPayment),
  },
  {
    name: 'purchaseInvoices', kind: 'ledger', perm: 'purchases', readPerm: READ, branched: true,
    validate: (d) => (str(d.supplierId) && Array.isArray(d.lines) && d.lines.length > 0 && finite(d.total) && finite(d.payable) ? null : 'An invoice needs a supplier, its lines and a total'),
    effects: (d) => invoiceEffects(d as unknown as PurchaseInvoice),
  },
  {
    name: 'purchaseReturns', kind: 'ledger', perm: 'purchases', readPerm: READ, branched: true,
    validate: (d) => (str(d.supplierId) && Array.isArray(d.items) && d.items.length > 0 && positive(d.total) ? null : 'A debit note needs a supplier, the goods and a total'),
    effects: (d) => returnEffects(d as unknown as PurchaseReturn),
  },
  {
    name: 'landedCosts', kind: 'ledger', perm: 'purchases', readPerm: READ, branched: true,
    validate: (d) => (str(d.purchaseId) && Array.isArray(d.lines) && d.lines.length > 0 && positive(d.total) ? null : 'Landed cost needs a receipt, its lines and a total'),
    effects: (d) => landedEffects(d as unknown as LandedCost),
  },
  { name: 'supplierPrices', kind: 'master', perm: 'purchases', readPerm: READ, validate: (d) => (str(d.supplierId) && str(d.variantId) && positive(d.price) ? null : 'A price needs a supplier, an item and an amount') },
  { name: 'rfqs', kind: 'master', perm: 'purchases', readPerm: READ, branched: true, validate: (d) => (Array.isArray(d.items) && Array.isArray(d.supplierIds) ? null : 'A request needs its items and suppliers') },
  { name: 'rfqQuotes', kind: 'master', perm: 'purchases', readPerm: READ, validate: (d) => (str(d.rfqId) && str(d.supplierId) && d.prices && typeof d.prices === 'object' ? null : 'A quote needs a request, a supplier and prices') },
)

// The server keeps what payments, debit notes, invoices and landed-cost bills did to a supplier's balance.
addOwnedFields('suppliers', ['payableAdjust'])

// A goods receipt that names an order updates it — on the phone and on the server, by the same function.
addEffects('purchases', (doc) => {
  const receipt = doc as unknown as Purchase
  return receipt.poId ? [{ kind: 'update', coll: 'purchaseOrders', id: receipt.poId, fn: (po) => orderAfterReceipt(po as unknown as PurchaseOrder, receipt) }] : []
})

const adjust = (supplierId: string, by: number): Effect[] => (by ? [{ kind: 'inc', coll: 'suppliers', id: supplierId, field: 'payableAdjust', by }] : [])
const sgn = (d: { reverses?: string }) => (d.reverses ? -1 : 1)

/** A payment takes its amount off what we owe (and a reversal puts it back). */
export const paymentEffects = (p: SupplierPayment): Effect[] => adjust(p.supplierId, -p.amount * sgn(p))
/** An invoice adds the part of it that is owed in its own right. */
export const invoiceEffects = (i: PurchaseInvoice): Effect[] => adjust(i.supplierId, i.payable * sgn(i))
/** A debit note takes off what we owe, less any money the supplier handed back at once. */
export const returnEffects = (r: PurchaseReturn): Effect[] => adjust(r.supplierId, -Math.round((r.total - r.refund) * 100) / 100 * sgn(r))
/** A bill for freight / duty from a transporter adds to what we owe them. */
export const landedEffects = (l: LandedCost): Effect[] => (l.payeeId ? adjust(l.payeeId, l.total * sgn(l)) : [])
