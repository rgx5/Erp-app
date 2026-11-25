import type { Address, Calculation, Invoice } from '@/api/schemas'
import { calculation } from '@/api/schemas'
import { currentApi } from '@/auth/session'
import { bridge } from '@/bridge'
import { formatDate } from '@/domain/format'
import { invoiceHtml, type DocOptions, type Seller } from './invoiceHtml'

export type PrintKind = 'quotation' | 'proforma' | 'order' | 'challan'
export interface DocSource {
  /** The document's own number (quote or order number). */
  no: string
  date: string
  companyId: string
  gstRegistrationId: string
  customerId: string
  lines: { itemId: string; description: string | null; quantity: string; unitPrice: string; discountPercent: string; taxInclusive: boolean }[]
  validUntil?: string | null | undefined
  notes?: string | null | undefined
  reference?: string | null | undefined
  vehicleNo?: string | null | undefined
  transporter?: string | null | undefined
}

const TITLE: Record<PrintKind, string> = { quotation: 'Quotation', proforma: 'Proforma Invoice', order: 'Sales Order', challan: 'Delivery Challan' }
const NUMBER_LABEL: Record<PrintKind, string> = { quotation: 'Quotation no.', proforma: 'Proforma no.', order: 'Order no.', challan: 'Challan no.' }
const NOTE: Record<PrintKind, (s: DocSource) => string> = {
  quotation: (s) => `This is a quotation, not a tax invoice. Prices and tax are estimates${s.validUntil ? `; valid until ${formatDate(s.validUntil)}` : ''}.`,
  proforma: (s) => `This is a proforma invoice for ${s.no}. It is not a tax invoice and cannot be used to claim input tax credit. A tax invoice will follow on supply.`,
  order: () => 'This is a sales order confirmation, not a tax invoice.',
  challan: () => 'Goods delivered against this challan. A tax invoice will follow; this is not a tax invoice.',
}

/** The same figures the tax invoice would carry, worked out by the server's own pricing code, laid out as a non-tax document. */
export function docFromCalculation(calc: Calculation, source: DocSource): Invoice {
  return {
    id: source.no, companyId: source.companyId, gstRegistrationId: source.gstRegistrationId, documentType: 'tax_invoice', invoiceNo: source.no, invoiceDate: source.date, customerId: calc.customer.id, customerName: calc.customer.name,
    customerGstin: calc.customer.gstin, customerGstTreatment: calc.customer.gstTreatment, placeOfSupply: calc.placeOfSupply, supplyType: calc.supplyType, taxPayment: null, reverseCharge: calc.reverseCharge, taxRegime: calc.taxRegime,
    taxableTotal: calc.totals.taxable, cgstTotal: calc.totals.cgst, sgstTotal: calc.totals.sgst, igstTotal: calc.totals.igst, cessTotal: calc.totals.cess, roundOff: calc.totals.roundOff, grandTotal: calc.totals.grandTotal,
    originalInvoiceId: null, reason: source.notes ?? null, status: 'posted', cancelledAt: null, cancelDate: null, cancelReason: null, dueDate: null, createdAt: source.date,
    lines: calc.lines.map((l) => ({
      id: String(l.lineNo), invoiceId: source.no, lineNo: l.lineNo, itemId: l.itemId, originalLineId: null, orderLineId: null, description: l.description, hsnSacCode: l.hsn, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent,
      taxInclusive: l.taxInclusive, taxableValue: l.taxableValue, taxCodeId: null, igstRate: l.rates.igst, cgstRate: l.rates.cgst, sgstRate: l.rates.sgst, cessRate: l.rates.cess,
      cgstAmount: l.cgst, sgstAmount: l.sgst, igstAmount: l.igst, cessAmount: l.cess, lineTotal: l.lineTotal, warehouseId: null, batchId: null, serialNos: null, unitCost: null, costValue: null,
    })),
  } as Invoice
}

/** Asks the server to price the document, then saves or prints it with the chosen title. */
export async function printSalesDoc(kind: PrintKind, source: DocSource, seller: Seller, billTo: Address | undefined): Promise<void> {
  const api = currentApi()
  const calc = await api.call(api.raw.POST('/v1/sales/invoices/calculate', {
    body: {
      companyId: source.companyId, gstRegistrationId: source.gstRegistrationId, documentType: 'tax_invoice', invoiceDate: source.date, customerId: source.customerId,
      lines: source.lines.map((l) => ({ itemId: l.itemId, ...(l.description ? { description: l.description } : {}), quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive })),
    } as never,
  }), calculation)
  const extraMeta: [string, string][] = kind === 'challan' ? [...(source.vehicleNo ? [['Vehicle no.', source.vehicleNo] as [string, string]] : []), ...(source.transporter ? [['Transporter', source.transporter] as [string, string]] : []), ...(source.reference ? [['Your reference', source.reference] as [string, string]] : [])] : []
  const opts: DocOptions = { title: TITLE[kind], numberLabel: NUMBER_LABEL[kind], note: NOTE[kind](source), noQr: kind !== 'proforma', ...(extraMeta.length ? { extraMeta } : {}) }
  await bridge.document.savePdf(invoiceHtml(docFromCalculation(calc, source), seller, billTo, opts), `${TITLE[kind].replaceAll(' ', '-')}-${source.no.replaceAll('/', '-')}`)
}
