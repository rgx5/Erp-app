import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const isoDate = z.iso.date();
const money = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A non-negative decimal with at most 4 places, as a string');
const quantity = z.string().regex(/^[0-9]{1,12}(\.[0-9]{1,6})?$/, 'A positive decimal with at most 6 places, as a string').refine((v) => Number(v) > 0, 'Must be greater than zero');
const percent = z.string().regex(/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/, 'A percentage from 0 to 100, as a string');
const serials = z.array(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$/)).min(1).max(5000);
const page = { limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().max(100).optional() };
const account = z.uuid().nullable().optional();

export const purchasingSettingsSchema = z
  .strictObject({
    payableAccountId: account, grniAccountId: account, purchasePriceVarianceAccountId: account, expensePurchaseAccountId: account, roundOffAccountId: account,
    inputCgstAccountId: account, inputSgstAccountId: account, inputIgstAccountId: account, inputCessAccountId: account,
    rcmCgstAccountId: account, rcmSgstAccountId: account, rcmIgstAccountId: account, rcmCessAccountId: account, freightAccountId: account, costVarianceAccountId: account,
    /** How far a bill's unit price may exceed the order price before it is held for approval. */
    priceTolerancePercent: percent.optional(),
    /** How far the billed quantity may exceed what was received (or ordered) before it is held for approval. */
    quantityTolerancePercent: percent.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one field');
export type PurchasingSettingsInput = z.infer<typeof purchasingSettingsSchema>;

// ---- purchase orders ------------------------------------------------------------------------------------------------
const orderLine = z.strictObject({
  itemId: z.uuid(),
  description: text(500).optional(),
  quantity,
  /** Price per unit before tax and before discount. */
  unitPrice: money,
  discountPercent: percent.default('0'),
  /** Expected tax code (the bill decides the real tax); defaults to the item's. */
  taxCodeId: z.uuid().optional(),
  /** Where this line is to be delivered. */
  warehouseId: z.uuid().optional(),
});
export const createPurchaseOrderSchema = z
  .strictObject({
    companyId: z.uuid(),
    gstRegistrationId: z.uuid(),
    businessLocationId: z.uuid().optional(),
    supplierId: z.uuid(),
    orderDate: isoDate,
    expectedDate: isoDate.optional(),
    supplierReference: text(100).optional(),
    notes: text(1000).optional(),
    lines: z.array(orderLine).min(1).max(500),
  })
  .refine((v) => !v.expectedDate || v.expectedDate >= v.orderDate, { path: ['expectedDate'], message: 'Must not be before the order date' });
export const listPurchaseOrdersQuery = z.object({ ...page, companyId: z.uuid(), supplierId: z.uuid().optional(), status: z.enum(['open', 'partially_received', 'received', 'closed', 'cancelled']).optional() });
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

// ---- goods receipts -------------------------------------------------------------------------------------------------
const receiptLine = z.strictObject({
  /** The order line being received. Omit for goods that arrive with no order (then `itemId`, `warehouseId` and `unitPrice` are required). */
  orderLineId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  quantity,
  /** Only for receipts with no order line: the cost per unit. Lines against an order are valued at the order's net price. */
  unitPrice: money.optional(),
  batch: z.strictObject({ batchNo: text(60), manufactureDate: isoDate.optional(), expiryDate: isoDate.optional() }).optional(),
  batchId: z.uuid().optional(),
  serialNos: serials.optional(),
});
export const createGoodsReceiptSchema = z.strictObject({
  companyId: z.uuid(),
  /** The supplier; taken from the order when `purchaseOrderId` is given. */
  supplierId: z.uuid().optional(),
  purchaseOrderId: z.uuid().optional(),
  receiptDate: isoDate,
  supplierDeliveryNote: text(100).optional(),
  notes: text(500).optional(),
  lines: z.array(receiptLine).min(1).max(500),
});
export const listGoodsReceiptsQuery = z.object({ ...page, companyId: z.uuid(), supplierId: z.uuid().optional(), purchaseOrderId: z.uuid().optional() });
export const grniQuery = z.object({ companyId: z.uuid(), asOf: isoDate });
export type CreateGoodsReceiptInput = z.infer<typeof createGoodsReceiptSchema>;

// ---- supplier bills, debit notes, returns ---------------------------------------------------------------------------
const billLine = z.strictObject({
  itemId: z.uuid(),
  description: text(500).optional(),
  quantity,
  /** Price per unit as the supplier billed it, before discount. */
  unitPrice: money,
  discountPercent: percent.default('0'),
  taxInclusive: z.boolean().default(false),
  /** Overrides the item's tax code. */
  taxCodeId: z.uuid().optional(),
  /** False when the tax on this line is not creditable (blocked credit): it is added to the cost instead. */
  itcEligible: z.boolean().default(true),
  /** The goods-receipt line this bill line bills. Required for stocked items. */
  grnLineId: z.uuid().optional(),
  /** The order line, for lines with no receipt (services). Taken from the receipt line when that has one. */
  poLineId: z.uuid().optional(),
  /** Where the cost of a non-stock line is booked; defaults to the company purchases expense account. */
  expenseAccountId: z.uuid().optional(),
});
export const createBillSchema = z.strictObject({
  companyId: z.uuid(),
  gstRegistrationId: z.uuid(),
  businessLocationId: z.uuid().optional(),
  supplierId: z.uuid(),
  supplierInvoiceNo: text(60),
  supplierInvoiceDate: isoDate,
  billDate: isoDate,
  /** Overrides where the goods/services are supplied (defaults to the buyer registration's state). */
  placeOfSupplyState: z.string().regex(/^[0-9]{2}$/).optional(),
  /** The supplier's state when it cannot be told from a GSTIN (unregistered suppliers). */
  supplierStateCode: z.string().regex(/^[0-9]{2}$/).optional(),
  /** The tax is paid by the buyer, not charged by the supplier. */
  reverseCharge: z.boolean().default(false),
  /** Approves a bill that is outside the price/quantity tolerance. Needs the purchasing:approve right and a reason. */
  overrideMatch: z.strictObject({ reason: text(300) }).optional(),
  lines: z.array(billLine).min(1).max(500),
}).refine((v) => v.billDate >= v.supplierInvoiceDate, { path: ['billDate'], message: 'Cannot be before the supplier invoice date' });
const debitLine = z.strictObject({
  originalLineId: z.uuid(),
  quantity,
  /** Defaults to the billed price; may be lower, never higher. */
  unitPrice: money.optional(),
  batchId: z.uuid().optional(),
  serialNos: serials.optional(),
});
export const createDebitNoteSchema = z.strictObject({ originalBillId: z.uuid(), noteDate: isoDate, reason: text(300), lines: z.array(debitLine).min(1).max(500) });
export const cancelBillSchema = z.strictObject({ cancelDate: isoDate, reason: text(300) });
export const returnReceiptSchema = z.strictObject({
  returnDate: isoDate,
  reason: text(300),
  lines: z.array(z.strictObject({ receiptLineId: z.uuid(), quantity, batchId: z.uuid().optional(), serialNos: serials.optional() })).min(1).max(500),
});
export const listBillsQuery = z.object({ ...page, companyId: z.uuid(), supplierId: z.uuid().optional(), documentType: z.enum(['bill', 'debit_note']).optional(), status: z.enum(['posted', 'cancelled']).optional(), from: isoDate.optional(), to: isoDate.optional() });
export type CreateBillInput = z.infer<typeof createBillSchema>;
export type CreateDebitNoteInput = z.infer<typeof createDebitNoteSchema>;
export type ReturnReceiptInput = z.infer<typeof returnReceiptSchema>;

// ---- payments and payables --------------------------------------------------------------------------------------------
const positive = z.string().regex(/^[0-9]{1,14}(\.[0-9]{1,4})?$/, 'A positive decimal with at most 4 places, as a string').refine((v) => Number(v) > 0, 'Must be greater than zero');
const allocationItem = z.strictObject({ billId: z.uuid(), amount: positive });
const methods = z.enum(['cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other']);
export const createPaymentSchema = z.strictObject({
  companyId: z.uuid(),
  supplierId: z.uuid(),
  paymentDate: isoDate,
  amount: positive,
  method: methods,
  /** The cash or bank account the money is paid out of. */
  paidFromAccountId: z.uuid(),
  reference: text(100).optional(),
  notes: text(500).optional(),
  /** Settle bills now; whatever is left stays on account as an advance to the supplier. */
  allocations: z.array(allocationItem).max(200).optional(),
});
export const allocatePaymentsSchema = z.strictObject({
  source: z.strictObject({ type: z.enum(['payment', 'debit_note']), id: z.uuid() }),
  allocatedOn: isoDate,
  allocations: z.array(allocationItem).min(1).max(200),
});
export const reversePayableAllocationSchema = z.strictObject({ on: isoDate, reason: text(300) });
export const cancelPaymentSchema = z.strictObject({ cancelDate: isoDate, reason: text(300) });
export const supplierRefundSchema = z.strictObject({
  companyId: z.uuid(),
  source: z.strictObject({ type: z.enum(['payment', 'debit_note']), id: z.uuid() }),
  refundDate: isoDate,
  amount: positive,
  method: methods,
  /** The cash or bank account the money lands in. */
  depositAccountId: z.uuid(),
  reference: text(100).optional(),
});
export const listPaymentsQuery = z.object({ ...page, companyId: z.uuid(), supplierId: z.uuid().optional(), status: z.enum(['posted', 'cancelled']).optional() });
export const payablesAsOfQuery = z.object({ companyId: z.uuid(), asOf: isoDate });
export const payablesStatementQuery = z.object({ companyId: z.uuid(), from: isoDate, to: isoDate }).refine((v) => v.to >= v.from, { path: ['to'], message: 'Must not be before from' });
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type SupplierRefundInput = z.infer<typeof supplierRefundSchema>;
