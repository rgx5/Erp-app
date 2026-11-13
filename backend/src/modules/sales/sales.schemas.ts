import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const money = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A non-negative decimal with at most 4 places, as a string');
const quantity = z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/, 'A positive decimal with at most 6 places, as a string').refine((v) => Number(v) > 0, 'Must be greater than zero');
const percent = z.string().regex(/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/, 'A percentage from 0 to 100, as a string');
const serials = z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/)).min(1).max(5000);
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };
const account = z.uuid().nullable().optional();

export const salesSettingsSchema = z
  .strictObject({
    receivableAccountId: account, salesAccountId: account, serviceSalesAccountId: account, cogsAccountId: account, roundOffAccountId: account,
    outputCgstAccountId: account, outputSgstAccountId: account, outputIgstAccountId: account, outputCessAccountId: account, writeOffAccountId: account,
  })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');

const invoiceLine = z.strictObject({
  itemId: z.uuid(),
  description: text(500).optional(),
  quantity,
  unitPrice: money,
  discountPercent: percent.default('0'),
  /** The unit price already contains the tax (retail MRP pricing). */
  taxInclusive: z.boolean().default(false),
  /** Overrides the item's tax code for this line. */
  taxCodeId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  serialNos: serials.optional(),
});

export const createInvoiceSchema = z.strictObject({
  companyId: z.uuid(),
  gstRegistrationId: z.uuid(),
  businessLocationId: z.uuid().optional(),
  documentType: z.enum(['tax_invoice', 'bill_of_supply']).default('tax_invoice'),
  invoiceDate: isoDate,
  customerId: z.uuid(),
  billToAddressId: z.uuid().optional(),
  shipToAddressId: z.uuid().optional(),
  /** Overrides the derived place of supply (a 2-digit GST state code). */
  placeOfSupplyState: z.string().regex(/^[0-9]{2}$/).optional(),
  reverseCharge: z.boolean().default(false),
  /** Required for SEZ and export customers: with payment of IGST, or without (under LUT / bond). */
  taxPayment: z.enum(['with_payment', 'without_payment']).optional(),
  lines: z.array(invoiceLine).min(1).max(500),
});

const noteLine = z.strictObject({
  originalLineId: z.uuid(),
  quantity,
  /** Defaults to the original line's price; may be lower, never higher. */
  unitPrice: money.optional(),
  /** Credit notes: bring returned goods back into stock (default true for stocked items). */
  returnStock: z.boolean().optional(),
  warehouseId: z.uuid().optional(),
  serialNos: serials.optional(),
});
export const createNoteSchema = z.strictObject({ originalInvoiceId: z.uuid(), noteDate: isoDate, reason: text(300), lines: z.array(noteLine).min(1).max(500) });
export const cancelInvoiceSchema = z.strictObject({ cancelDate: isoDate, reason: text(300) });
export const listInvoicesQuery = z.object({
  ...page,
  companyId: z.uuid(),
  customerId: z.uuid().optional(),
  documentType: z.enum(['tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note']).optional(),
  status: z.enum(['posted', 'cancelled']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type SalesSettingsInput = z.infer<typeof salesSettingsSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuery>;

// ---- quotes and orders -----------------------------------------------------------------------------------------------
const docLine = z.strictObject({
  itemId: z.uuid(),
  description: text(500).optional(),
  quantity,
  unitPrice: money,
  discountPercent: percent.default('0'),
  taxInclusive: z.boolean().default(false),
  taxCodeId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  batchId: z.uuid().optional(),
});
const docHeader = {
  companyId: z.uuid(),
  gstRegistrationId: z.uuid(),
  businessLocationId: z.uuid().optional(),
  customerId: z.uuid(),
  billToAddressId: z.uuid().optional(),
  shipToAddressId: z.uuid().optional(),
  placeOfSupplyState: z.string().regex(/^[0-9]{2}$/).optional(),
  reverseCharge: z.boolean().default(false),
  taxPayment: z.enum(['with_payment', 'without_payment']).optional(),
  documentType: z.enum(['tax_invoice', 'bill_of_supply']).default('tax_invoice'),
};
export const createQuoteSchema = z
  .strictObject({ ...docHeader, quoteDate: isoDate, validUntil: isoDate, notes: text(1000).optional(), lines: z.array(docLine.omit({ batchId: true })).min(1).max(500) })
  .refine((v) => v.validUntil >= v.quoteDate, { path: ['validUntil'], message: 'Must not be before the quote date' });
export const createOrderSchema = z.strictObject({
  ...docHeader,
  orderDate: isoDate,
  customerReference: text(100).optional(),
  /** Hold the stock for this order (stocked lines need a warehouse). */
  reserveStock: z.boolean().default(false),
  lines: z.array(docLine).min(1).max(500),
});
export const convertQuoteSchema = z.strictObject({ orderDate: isoDate, customerReference: text(100).optional(), reserveStock: z.boolean().default(false) });
export const invoiceOrderSchema = z.strictObject({
  invoiceDate: isoDate,
  /** Omit to invoice everything still outstanding. */
  lines: z.array(z.strictObject({ orderLineId: z.uuid(), quantity, serialNos: serials.optional() })).min(1).optional(),
});
export const listQuotesQuery = z.object({ ...page, companyId: z.uuid(), customerId: z.uuid().optional(), status: z.enum(['open', 'rejected', 'converted']).optional() });
export const listOrdersQuery = z.object({ ...page, companyId: z.uuid(), customerId: z.uuid().optional(), status: z.enum(['open', 'partially_invoiced', 'invoiced', 'closed', 'cancelled']).optional() });
export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

// ---- receipts and receivables ----------------------------------------------------------------------------------------
const positive = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A positive decimal with at most 4 places, as a string').refine((v) => Number(v) > 0, 'Must be greater than zero');
const allocationItem = z.strictObject({ invoiceId: z.uuid(), amount: positive });
export const createReceiptSchema = z.strictObject({
  companyId: z.uuid(),
  customerId: z.uuid(),
  receiptDate: isoDate,
  amount: positive,
  method: z.enum(['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other']),
  /** The cash or bank account the money lands in. */
  depositAccountId: z.uuid(),
  reference: text(100).optional(),
  notes: text(500).optional(),
  /** Settle invoices now; whatever is left stays on account as an advance. */
  allocations: z.array(allocationItem).max(200).optional(),
});
export const allocateSchema = z
  .strictObject({
    source: z.strictObject({ type: z.enum(['receipt', 'credit_note']), id: z.uuid() }),
    allocatedOn: isoDate,
    allocations: z.array(allocationItem).min(1).max(200),
  });
export const reverseAllocationSchema = z.strictObject({ on: isoDate, reason: text(300) });
export const cancelReceiptSchema = z.strictObject({ cancelDate: isoDate, reason: text(300) });
export const writeOffSchema = z.strictObject({ invoiceId: z.uuid(), amount: positive, date: isoDate, reason: text(300) });
export const listReceiptsQuery = z.object({ ...page, companyId: z.uuid(), customerId: z.uuid().optional(), status: z.enum(['posted', 'cancelled']).optional() });
export const asOfQuery = z.object({ companyId: z.uuid(), asOf: isoDate });
export const positionQuery = z.object({ companyId: z.uuid(), asOf: isoDate });
export const statementQuery = z.object({ companyId: z.uuid(), from: isoDate, to: isoDate }).refine((v) => v.to >= v.from, { path: ['to'], message: 'Must not be before from' });
export type CreateReceiptInput = z.infer<typeof createReceiptSchema>;

export const refundSchema = z
  .strictObject({
    companyId: z.uuid(),
    source: z.strictObject({ type: z.enum(['receipt', 'credit_note']), id: z.uuid() }),
    refundDate: isoDate,
    amount: positive,
    method: z.enum(['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other']),
    /** The cash or bank account the money is paid out of. */
    paidFromAccountId: z.uuid(),
    reference: text(100).optional(),
  });
