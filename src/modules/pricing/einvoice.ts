import { gstinProblem, gstinState, stateName, taxInfoOf } from '@/domain/gst'
import { round2 } from '@/domain/money'
import { round3 } from '@/domain/qty'
import type { Bill, BillItem, Customer, StoreSettings } from '@/domain/types'
import { variantLabel } from '@/domain/codes'
import type { EInvoiceRecord, PartyDetails, PricingSettings } from './types'

/**
 * E-invoice (GST's Invoice Registration Portal, "IRP"): the JSON a registered business sends for each B2B invoice and credit note,
 * in the NIC schema version 1.1.
 *
 * WHAT HAPPENS HERE, AND WHAT DOES NOT. This file builds the payload and checks it against the rules the portal enforces, so it
 * can be exported and uploaded (the portal's bulk-upload tool takes the exported file). Registering it — getting the IRN, the
 * acknowledgement number and the digitally signed QR code — happens only on the government portal (or through a GST suvidha
 * provider with API credentials). The app cannot do that offline and does not pretend to: a person pastes the portal's answer back
 * (`parseIrpResponse`) and the bill then prints the real IRN and QR. No IRN is ever made up here.
 */

export interface EInvoicePayload {
  Version: '1.1'
  TranDtls: { TaxSch: 'GST'; SupTyp: 'B2B'; RegRev: 'Y' | 'N'; IgstOnIntra: 'N' }
  DocDtls: { Typ: 'INV' | 'CRN'; No: string; Dt: string }
  SellerDtls: { Gstin: string; LglNm: string; Addr1: string; Addr2?: string; Loc: string; Pin: number; Stcd: string; Ph?: string; Em?: string }
  BuyerDtls: { Gstin: string; LglNm: string; Pos: string; Addr1: string; Addr2?: string; Loc: string; Pin: number; Stcd: string }
  PrecDocDtls?: Array<{ InvNo: string; InvDt: string }>
  ItemList: Array<{
    SlNo: string; PrdDesc: string; IsServc: 'Y' | 'N'; HsnCd: string; Qty: number; Unit: string; UnitPrice: number; TotAmt: number
    Discount: number; AssAmt: number; GstRt: number; IgstAmt: number; CgstAmt: number; SgstAmt: number; CesRt: number; CesAmt: number; TotItemVal: number
  }>
  ValDtls: { AssVal: number; CgstVal: number; SgstVal: number; IgstVal: number; CesVal: number; Discount: number; RndOffAmt: number; TotInvVal: number }
}

const p2 = (n: number) => String(n).padStart(2, '0')
/** `19/10/2026`, the portal's date format. */
export const portalDate = (ms: number) => { const d = new Date(ms); return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` }
/** Indian financial year of a date: `2026-27` for October 2026. */
export const financialYear = (ms: number) => { const d = new Date(ms); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${p2((y + 1) % 100)}` }

/** The portal's unit quantity codes (UQC) for the units this app sells in; anything else goes as `OTH`. */
const UQC: Record<string, string> = {
  pc: 'PCS', pcs: 'PCS', nos: 'NOS', unit: 'UNT', m: 'MTR', cm: 'CMS', kg: 'KGS', g: 'GMS', l: 'LTR', ml: 'MLT', pair: 'PRS', set: 'SET', dozen: 'DOZ',
  pack: 'PAC', box: 'BOX', bottle: 'BTL', roll: 'ROL', bag: 'BAG', can: 'CAN', carton: 'CTN', tube: 'TUB', sqft: 'SQF', sqm: 'SQM', ton: 'TON', quintal: 'QTL',
}
export const uqc = (unit?: string) => (unit ? UQC[unit.toLowerCase()] ?? 'OTH' : 'NOS')

/** Services carry a SAC code, which starts 99; goods carry an HSN code. */
export const isService = (hsn: string) => /^99/.test(hsn.trim())

const cut = (s: string, n: number) => s.trim().slice(0, n)
const DOC_NO = /^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/
const HSN = /^(\d{4}|\d{6}|\d{8})$/
const PIN = /^[1-9]\d{5}$/

export interface PayloadBuild<P> { payload: P; problems: string[] }

export interface EInvoiceInput {
  bill: Bill
  store: StoreSettings
  settings?: PricingSettings | null
  customer?: Customer | null
  record?: Pick<EInvoiceRecord, 'buyer'> | null
  /** For a credit note: the invoice it is against. */
  original?: Bill | null
}

const isCredit = (b: Bill) => !!b.refundOfBillId || b.total < 0

/** Why a bill is not an e-invoice case (or null when it is one): only tax invoices to a registered buyer from a regular dealer. */
export function eInvoiceSkipReason(bill: Bill, store: StoreSettings | null | undefined, customer?: Pick<Customer, 'gstin'> | null): string | null {
  if (bill.status === 'held') return 'A parked bill is not an invoice yet.'
  if (store?.registrationType === 'composition' || store?.registrationType === 'unregistered') return 'Composition and unregistered dealers do not issue e-invoices.'
  const info = taxInfoOf(bill)
  if (info.taxMode === 'bill_of_supply') return 'A bill of supply is not an e-invoice document.'
  const gstin = (info.buyerGstin || customer?.gstin || '').trim()
  if (!gstin) return 'E-invoices are for sales to GST-registered buyers; this bill has no buyer GSTIN.'
  return null
}

const money = round2

/** Builds the IRP payload for a bill. `problems` lists everything the portal would refuse, in words; an empty list means it is ready to export. */
export function buildEInvoice({ bill, store, settings, customer, record, original }: EInvoiceInput): PayloadBuild<EInvoicePayload> {
  const problems: string[] = []
  const info = taxInfoOf(bill)
  const credit = isCredit(bill)
  const skip = eInvoiceSkipReason(bill, store, customer)
  if (skip) problems.push(skip)

  const sellerGstin = (store.gstin ?? '').trim().toUpperCase()
  const sp = gstinProblem(sellerGstin)
  if (!sellerGstin || sp) problems.push(sellerGstin ? `The shop’s GSTIN: ${sp}` : 'Add the shop’s GSTIN in Settings.')
  const addr1 = cut(store.address ?? '', 100)
  if (!addr1) problems.push('Add the shop’s address in Settings.')
  const sellerLoc = cut(store.city ?? '', 50)
  if (sellerLoc.length < 3) problems.push('Add the shop’s city (at least 3 letters) in Settings.')
  const sellerPin = (settings?.sellerPin ?? '').trim()
  if (!PIN.test(sellerPin)) problems.push('Add the shop’s 6-digit pincode in the e-invoice settings.')

  const buyerGstin = (info.buyerGstin || customer?.gstin || '').trim().toUpperCase()
  if (buyerGstin) { const bp = gstinProblem(buyerGstin); if (bp) problems.push(`Buyer GSTIN: ${bp}`) }
  const party: PartyDetails = record?.buyer ?? {}
  const buyerName = cut(party.name || info.buyerName || customer?.name || '', 100)
  if (!buyerName) problems.push('Add the buyer’s legal name.')
  const buyerAddr1 = cut(party.addr1 || customer?.address || '', 100)
  if (!buyerAddr1) problems.push('Add the buyer’s address.')
  const buyerLoc = cut(party.loc ?? '', 50)
  if (buyerLoc.length < 3) problems.push('Add the buyer’s city or town (at least 3 letters).')
  const buyerPin = (party.pin ?? '').trim()
  if (!PIN.test(buyerPin)) problems.push('Add the buyer’s 6-digit pincode.')
  const buyerState = gstinState(buyerGstin)
  const pos = info.placeOfSupply || buyerState
  if (!pos) problems.push('Choose the place of supply.')

  if (!DOC_NO.test(bill.no)) problems.push(`The bill number “${bill.no}” cannot go to the portal: it must be 16 letters, digits, “/” or “-” at most, and not start with 0 or a symbol.`)

  // A credit note's lines already hold positive amounts (what is being given back); the portal wants them positive too.
  const items = bill.items.map((it: BillItem, n) => {
    const hsn = (it.hsn ?? '').trim()
    if (!HSN.test(hsn)) problems.push(`${it.name}: the HSN code must be 4, 6 or 8 digits${hsn ? ` (it is “${hsn}”)` : ''}. Set it on the item.`)
    const taxable = money(Math.abs(it.taxable))
    const qty = Math.abs(round3(it.qty))
    const lbl = variantLabel(it.size, it.color)
    const igst = money(Math.abs(it.igst ?? 0))
    const cgst = money(Math.abs(it.cgst))
    const sgst = money(Math.abs(it.sgst))
    return {
      SlNo: String(n + 1), PrdDesc: cut(`${it.name}${lbl ? ` ${lbl}` : ''}`, 300), IsServc: (isService(hsn) ? 'Y' : 'N') as 'Y' | 'N', HsnCd: hsn, Qty: qty, Unit: uqc(it.unit),
      // The portal wants the price before tax. The bill's prices are usually tax-inclusive, so the unit price is worked back from the taxable value.
      UnitPrice: qty > 0 ? Math.round((taxable / qty) * 1000) / 1000 : 0, TotAmt: taxable, Discount: 0, AssAmt: taxable, GstRt: it.taxRate,
      IgstAmt: igst, CgstAmt: cgst, SgstAmt: sgst, CesRt: 0, CesAmt: 0, TotItemVal: money(taxable + igst + cgst + sgst),
    }
  })
  if (!items.length) problems.push('The bill has no items.')

  const sum = (f: (i: (typeof items)[number]) => number) => money(items.reduce((s, i) => s + f(i), 0))
  const val = {
    AssVal: sum((i) => i.AssAmt), CgstVal: sum((i) => i.CgstAmt), SgstVal: sum((i) => i.SgstAmt), IgstVal: sum((i) => i.IgstAmt), CesVal: 0, Discount: 0,
    RndOffAmt: money(bill.roundOff), TotInvVal: money(Math.abs(bill.total)),
  }
  // The portal checks the invoice value against the items (within a rupee). A mismatch means the bill's own figures disagree.
  if (Math.abs(sum((i) => i.TotItemVal) + val.RndOffAmt - val.TotInvVal) > 1) problems.push('The items do not add up to the invoice total. The bill cannot be sent as it is.')
  if (!credit && val.TotInvVal <= 0) problems.push('The invoice value must be above zero.')
  if (items.some((i) => i.IgstAmt > 0) && items.some((i) => i.CgstAmt > 0 || i.SgstAmt > 0)) problems.push('The bill mixes IGST with CGST/SGST; a bill is one or the other.')

  const payload: EInvoicePayload = {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: info.reverseCharge ? 'Y' : 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: credit ? 'CRN' : 'INV', No: bill.no, Dt: portalDate(bill.date) },
    SellerDtls: {
      Gstin: sellerGstin, LglNm: cut(settings?.legalName || store.name, 100), Addr1: addr1, ...(settings?.sellerAddr2?.trim() ? { Addr2: cut(settings.sellerAddr2, 100) } : {}),
      Loc: sellerLoc, Pin: Number(sellerPin) || 0, Stcd: gstinState(sellerGstin),
      ...(/^\d{6,12}$/.test((store.phone ?? '').replace(/\D/g, '')) ? { Ph: (store.phone ?? '').replace(/\D/g, '').slice(-12) } : {}),
      ...(/^\S+@\S+\.\S+$/.test(store.email ?? '') ? { Em: cut(store.email, 100) } : {}),
    },
    BuyerDtls: {
      Gstin: buyerGstin, LglNm: buyerName, Pos: pos, Addr1: buyerAddr1, ...(party.addr2?.trim() ? { Addr2: cut(party.addr2, 100) } : {}), Loc: buyerLoc, Pin: Number(buyerPin) || 0,
      Stcd: buyerState,
    },
    ItemList: items,
    ValDtls: val,
  }
  if (credit) {
    if (!original) problems.push('A credit note names the invoice it is against, and that invoice could not be found.')
    else payload.PrecDocDtls = [{ InvNo: original.no, InvDt: portalDate(original.date) }]
  }
  return { payload, problems: [...new Set(problems)] }
}

/** The file for the portal's bulk upload: the payloads of every invoice, as a JSON array. */
export const eInvoiceFile = (payloads: EInvoicePayload[]) => JSON.stringify(payloads, null, 2)

export interface IrpAck { irn: string; ackNo: string; ackDate: string; signedQr?: string; signedInvoice?: string }

const findKey = (o: unknown, key: string, depth = 0): unknown => {
  if (!o || typeof o !== 'object' || depth > 5) return undefined
  if (Array.isArray(o)) { for (const x of o) { const r = findKey(x, key, depth + 1); if (r !== undefined) return r } return undefined }
  for (const [k, v] of Object.entries(o)) if (k.toLowerCase() === key.toLowerCase() && v !== null && v !== undefined && v !== '') return v
  for (const v of Object.values(o)) { const r = findKey(v, key, depth + 1); if (r !== undefined) return r }
  return undefined
}

/** Reads the portal's answer (the JSON it returns for a registered invoice) into what the bill needs: IRN, acknowledgement, signed QR. */
export function parseIrpResponse(text: string): { ok: true; ack: IrpAck } | { ok: false; message: string } {
  let json: unknown
  try { json = JSON.parse(text.trim()) } catch { return { ok: false, message: 'That is not JSON. Paste the portal’s response exactly as it gave it.' } }
  const irn = String(findKey(json, 'Irn') ?? '').trim()
  if (!irn) return { ok: false, message: 'No IRN found in that response. Was the invoice registered?' }
  if (!/^[0-9a-f]{64}$/i.test(irn)) return { ok: false, message: 'The IRN should be 64 letters and digits.' }
  const ackNo = String(findKey(json, 'AckNo') ?? '').trim()
  if (!ackNo) return { ok: false, message: 'No acknowledgement number found in that response.' }
  const qr = findKey(json, 'SignedQRCode')
  const inv = findKey(json, 'SignedInvoice')
  return { ok: true, ack: { irn: irn.toLowerCase(), ackNo, ackDate: String(findKey(json, 'AckDt') ?? '').trim(), ...(typeof qr === 'string' && qr ? { signedQr: qr } : {}), ...(typeof inv === 'string' && inv ? { signedInvoice: inv } : {}) } }
}

/** Short status for lists. */
export const EINVOICE_STATUS: Record<EInvoiceRecord['status'], string> = { prepared: 'Prepared', registered: 'IRN recorded', cancelled: 'Cancelled' }

export { stateName }
