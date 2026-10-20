import { gstinProblem, gstinState, taxInfoOf } from '@/domain/gst'
import { groupIndian, round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import type { Bill, Customer, StoreSettings } from '@/domain/types'
import { variantLabel } from '@/domain/codes'
import { isService, portalDate, uqc, type PayloadBuild } from './einvoice'
import type { EwayRecord, PartyDetails, PricingSettings, Transport } from './types'

/**
 * E-way bill: the document that must travel with goods moving worth more than the threshold. This builds the JSON in the NIC
 * format and checks it. Generating the e-way bill number happens only on the e-way bill portal (or an API provider): export the
 * file, upload it in the portal's bulk-generation screen, and record the number it gives here.
 */

export const DEFAULT_EWB_THRESHOLD = 50_000
const MODE: Record<Transport['mode'], number> = { road: 1, rail: 2, air: 3, ship: 4 }
export const TRANSPORT_MODES: Array<{ value: Transport['mode']; label: string }> = [
  { value: 'road', label: 'Road' }, { value: 'rail', label: 'Rail' }, { value: 'air', label: 'Air' }, { value: 'ship', label: 'Ship' },
]

export interface EwayPayload {
  supplyType: 'O'
  subSupplyType: 1
  subSupplyDesc: string
  docType: 'INV' | 'BIL'
  docNo: string
  docDate: string
  fromGstin: string
  fromTrdName: string
  fromAddr1: string
  fromAddr2: string
  fromPlace: string
  fromPincode: number
  actFromStateCode: number
  fromStateCode: number
  toGstin: string
  toTrdName: string
  toAddr1: string
  toAddr2: string
  toPlace: string
  toPincode: number
  actToStateCode: number
  toStateCode: number
  transactionType: 1
  otherValue: number
  totalValue: number
  cgstValue: number
  sgstValue: number
  igstValue: number
  cessValue: number
  cessNonAdvolValue: number
  totInvValue: number
  transporterId: string
  transporterName: string
  transDocNo: string
  transDocDate: string
  transMode: number
  transDistance: number
  vehicleNo: string
  vehicleType: 'R' | 'O'
  itemList: Array<{ productName: string; productDesc: string; hsnCode: number; quantity: number; qtyUnit: string; taxableAmount: number; sgstRate: number; cgstRate: number; igstRate: number; cessRate: number }>
}

const PIN = /^[1-9]\d{5}$/
/** A vehicle registration as the portal takes it: no spaces or dashes, e.g. MH12AB1234. */
export const normalVehicleNo = (v: string) => v.toUpperCase().replace(/[\s-]/g, '')
export const vehicleProblem = (v: string): string | null =>
  /^([A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}|\d{2}BH\d{4}[A-Z]{1,2})$/.test(normalVehicleNo(v)) ? null : 'A vehicle number looks like MH12AB1234.'

/** The `dd/mm/yyyy` the portal wants from a `YYYY-MM-DD` the person typed. */
const fromInputDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s.slice(8)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '')

/** Days an e-way bill stays valid for a distance: 1 day per 200 km (or part of it) for ordinary cargo, per 20 km for over-dimensional cargo. */
export const ewbValidityDays = (km: number, odc = false) => Math.max(1, Math.ceil(km / (odc ? 20 : 200)))

/** Does moving this bill's goods need an e-way bill? Goods only (not services), a sale (not a credit note), above the threshold. */
export function ewbNeeded(bill: Bill, settings?: PricingSettings | null): { needed: boolean; reason: string } {
  const threshold = settings?.ewbThreshold ?? DEFAULT_EWB_THRESHOLD
  if (bill.status === 'held') return { needed: false, reason: 'A parked bill is not a sale yet.' }
  if (bill.refundOfBillId || bill.total < 0) return { needed: false, reason: 'A credit note is not a movement of goods.' }
  if (bill.items.length && bill.items.every((i) => isService(i.hsn ?? ''))) return { needed: false, reason: 'Services need no e-way bill.' }
  const value = round2(Math.abs(bill.total))
  return value > threshold ? { needed: true, reason: `The goods are worth more than ₹${groupIndian(String(threshold))}.` } : { needed: false, reason: `Below ₹${groupIndian(String(threshold))} — not required unless your state says otherwise.` }
}

export interface EwayInput {
  bill: Bill
  store: StoreSettings
  settings?: PricingSettings | null
  customer?: Customer | null
  /** The buyer's address as filled in for the e-invoice, if there is one. */
  buyer?: PartyDetails
  record?: Pick<EwayRecord, 'transport' | 'shipTo'> | null
}

export const DEFAULT_TRANSPORT: Transport = { mode: 'road', distanceKm: 0 }

/** Builds the e-way bill payload (Part A and, when given, Part B) and lists what the portal would refuse. */
export function buildEway({ bill, store, settings, customer, buyer, record }: EwayInput): PayloadBuild<EwayPayload> {
  const problems: string[] = []
  const info = taxInfoOf(bill)
  const transport = record?.transport ?? DEFAULT_TRANSPORT
  if (bill.refundOfBillId || bill.total < 0) problems.push('An e-way bill is for goods being sent, not for a credit note.')
  if (bill.status === 'held') problems.push('A parked bill is not a sale yet.')

  const fromGstin = (store.gstin ?? '').trim().toUpperCase()
  const fp = gstinProblem(fromGstin)
  if (!fromGstin || fp) problems.push(fromGstin ? `The shop’s GSTIN: ${fp}` : 'Add the shop’s GSTIN in Settings.')
  const fromPin = (settings?.sellerPin ?? '').trim()
  if (!PIN.test(fromPin)) problems.push('Add the dispatch pincode (the shop’s) in the e-invoice settings.')
  if (!(store.address ?? '').trim()) problems.push('Add the shop’s address in Settings.')
  const fromState = gstinState(fromGstin)

  const toGstinRaw = (info.buyerGstin || customer?.gstin || '').trim().toUpperCase()
  if (toGstinRaw) { const tp = gstinProblem(toGstinRaw); if (tp) problems.push(`Buyer GSTIN: ${tp}`) }
  const ship = record?.shipTo ?? {}
  const toPin = (ship.pin || buyer?.pin || '').trim()
  if (!PIN.test(toPin)) problems.push('Add the delivery pincode.')
  const toState = gstinState(toGstinRaw) || info.placeOfSupply || ''
  if (!toState) problems.push('Choose the place of supply or add the buyer’s GSTIN, so the delivery state is known.')

  if (!(transport.distanceKm >= 0 && transport.distanceKm <= 4000)) problems.push('Distance is between 0 and 4000 km (0 lets the portal work it out from the pincodes).')
  const vehicle = normalVehicleNo(transport.vehicleNo ?? '')
  if (vehicle) { const vp = vehicleProblem(vehicle); if (vp) problems.push(vp) }
  const transId = (transport.transporterId ?? '').trim().toUpperCase()
  if (transId) { const tp = gstinProblem(transId); if (tp) problems.push(`Transporter ID: ${tp}`) }
  if (!vehicle && !transId) problems.push('Give a vehicle number, or the transporter’s GSTIN if the transporter will add the vehicle later.')
  if (transport.transDocDate && !fromInputDate(transport.transDocDate)) problems.push('Write the transporter document date as YYYY-MM-DD.')

  const items = bill.items.map((it) => {
    const hsn = (it.hsn ?? '').trim()
    if (!/^\d{4,8}$/.test(hsn)) problems.push(`${it.name}: the HSN code must be 4 to 8 digits. Set it on the item.`)
    const rate = it.taxRate
    const inter = it.igst !== undefined
    const lbl = variantLabel(it.size, it.color)
    return {
      productName: it.name.slice(0, 100), productDesc: lbl.slice(0, 100), hsnCode: Number(hsn) || 0, quantity: round3(Math.abs(it.qty)), qtyUnit: uqc(it.unit),
      taxableAmount: round2(Math.abs(it.taxable)), sgstRate: inter ? 0 : rate / 2, cgstRate: inter ? 0 : rate / 2, igstRate: inter ? rate : 0, cessRate: 0,
    }
  })
  if (!items.length) problems.push('The bill has no items.')

  const taxable = round2(items.reduce((s, i) => s + i.taxableAmount, 0))
  const cgst = round2(Math.abs(bill.cgstTotal))
  const sgst = round2(Math.abs(bill.sgstTotal))
  const igst = round2(Math.abs(bill.igstTotal ?? bill.items.reduce((s, i) => s + (i.igst ?? 0), 0)))
  const totInv = round2(Math.abs(bill.total))
  const payload: EwayPayload = {
    supplyType: 'O', subSupplyType: 1, subSupplyDesc: '', docType: info.taxMode === 'bill_of_supply' ? 'BIL' : 'INV', docNo: bill.no, docDate: portalDate(bill.date),
    fromGstin, fromTrdName: (settings?.legalName || store.name).slice(0, 100), fromAddr1: (store.address ?? '').slice(0, 120), fromAddr2: (settings?.sellerAddr2 ?? '').slice(0, 120),
    fromPlace: (store.city ?? '').slice(0, 50), fromPincode: Number(fromPin) || 0, actFromStateCode: Number(fromState) || 0, fromStateCode: Number(fromState) || 0,
    toGstin: toGstinRaw || 'URP', toTrdName: (buyer?.name || info.buyerName || customer?.name || '').slice(0, 100),
    toAddr1: (ship.addr1 || buyer?.addr1 || customer?.address || '').slice(0, 120), toAddr2: (ship.addr2 || buyer?.addr2 || '').slice(0, 120), toPlace: (ship.loc || buyer?.loc || '').slice(0, 50),
    toPincode: Number(toPin) || 0, actToStateCode: Number(toState) || 0, toStateCode: Number(toState) || 0,
    transactionType: 1, otherValue: round2(totInv - taxable - cgst - sgst - igst), totalValue: taxable, cgstValue: cgst, sgstValue: sgst, igstValue: igst, cessValue: 0, cessNonAdvolValue: 0,
    totInvValue: totInv, transporterId: transId, transporterName: (transport.transporterName ?? '').slice(0, 100), transDocNo: (transport.transDocNo ?? '').slice(0, 15),
    transDocDate: fromInputDate(transport.transDocDate ?? ''), transMode: MODE[transport.mode] ?? 1, transDistance: Math.round(transport.distanceKm || 0),
    vehicleNo: vehicle, vehicleType: transport.vehicleType === 'odc' ? 'O' : 'R', itemList: items,
  }
  return { payload, problems: [...new Set(problems)] }
}

/** The file for the e-way bill portal's bulk generation: `{ version, billLists }`. */
export const ewayFile = (payloads: EwayPayload[]) => JSON.stringify({ version: '1.0.0621', billLists: payloads }, null, 2)

export const EWAY_STATUS: Record<EwayRecord['status'], string> = { prepared: 'Prepared', generated: 'E-way bill recorded', cancelled: 'Cancelled' }

/** A 12-digit e-way bill number. */
export const ewbNoProblem = (n: string): string | null => (/^\d{12}$/.test(n.trim()) ? null : 'An e-way bill number has 12 digits.')
