import { z } from 'zod'

/** The server documents request bodies in OpenAPI but not (yet) responses, so each response a screen relies on is checked here at runtime. */
export const meta = z.object({
  app: z.literal('onesync-erp'),
  apiVersion: z.string(),
  auth: z.object({ passwordLogin: z.boolean(), mfa: z.boolean(), apiKeys: z.boolean(), selfSignup: z.boolean() }),
  time: z.string(),
})

export const user = z.object({
  id: z.string(), email: z.string(), displayName: z.string(), status: z.string(), mfaEnabled: z.boolean(), lastLoginAt: z.string().nullable(),
  roleIds: z.array(z.string()).optional(), version: z.number().optional(),
})
export type User = z.infer<typeof user>

export const session = z.object({ accessToken: z.string(), refreshToken: z.string(), tokenType: z.string(), expiresIn: z.number(), user })
export type SessionResponse = z.infer<typeof session>

export const me = z.object({ kind: z.enum(['user', 'api_key']), user: user.optional(), permissions: z.array(z.string()) })
export type Me = z.infer<typeof me>

export const company = z.object({ id: z.string(), legalName: z.string(), tradeName: z.string().nullable(), pan: z.string().nullable(), baseCurrency: z.string(), fiscalYearStartMonth: z.number(), status: z.string(), version: z.number() })
export type Company = z.infer<typeof company>

export const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() })

const money = z.string()
const period = z.object({ revenue: money, expenses: money, profit: money })
export const dashboard = z.object({
  companyId: z.string(), asOf: z.string(),
  fiscalYear: z.object({ id: z.string(), label: z.string(), startDate: z.string(), endDate: z.string() }),
  cash: z.object({ total: money, accounts: z.array(z.object({ accountId: z.string(), code: z.string(), name: z.string(), balance: money })) }),
  month: period.extend({ from: z.string(), previousMonth: period.optional() }),
  yearToDate: period.extend({ from: z.string(), netMarginPercent: z.string().nullable() }),
  inventoryValue: money,
  trend: z.array(period.extend({ month: z.string() })),
  receivables: z.object({ total: money, current: money, overdue: money }),
  payables: z.object({ total: money, current: money, overdue: money }),
  attention: z.object({ pendingApprovals: z.number(), unmatchedBankLines: z.number(), openPurchaseOrders: z.number(), openWorkOrders: z.number() }),
})
export type Dashboard = z.infer<typeof dashboard>

export const gstRegistration = z.object({ id: z.string(), companyId: z.string(), gstin: z.string(), stateCode: z.string(), legalName: z.string(), tradeName: z.string().nullable(), registrationType: z.string(), status: z.string(), effectiveFrom: z.string(), effectiveTo: z.string().nullable() })
export type GstRegistration = z.infer<typeof gstRegistration>

export const businessLocation = z.object({
  id: z.string(), companyId: z.string(), gstRegistrationId: z.string(), code: z.string(), name: z.string(), isPrincipalPlace: z.boolean(), status: z.string(),
  address: z.object({ line1: z.string(), line2: z.string().nullable(), city: z.string(), stateCode: z.string(), pincode: z.string() }),
})
export type BusinessLocation = z.infer<typeof businessLocation>

export const warehouse = z.object({ id: z.string(), businessLocationId: z.string(), code: z.string(), name: z.string(), kind: z.string(), status: z.string(), allowNegativeStock: z.boolean().optional() })
export type Warehouse = z.infer<typeof warehouse>

export const fiscalYear = z.object({ id: z.string(), companyId: z.string(), label: z.string(), startDate: z.string(), endDate: z.string() })
export type FiscalYear = z.infer<typeof fiscalYear>

export const setupStatus = z.object({
  companyId: z.string(), ready: z.boolean(), canApplyDefaults: z.boolean(),
  checks: z.array(z.object({ key: z.string(), label: z.string(), done: z.boolean(), detail: z.string(), defaultable: z.boolean() })),
})
export type SetupStatus = z.infer<typeof setupStatus>

export const applyDefaultsResult = z.object({
  steps: z.array(z.object({ key: z.string(), action: z.enum(['created', 'skipped', 'blocked']), detail: z.string() })),
  status: setupStatus,
})
export type ApplyDefaultsResult = z.infer<typeof applyDefaultsResult>

const stamps = { version: z.number(), createdAt: z.string(), updatedAt: z.string() }

export const unit = z.object({ id: z.string(), code: z.string(), name: z.string(), uqc: z.string().nullable(), decimalPlaces: z.number(), status: z.string(), ...stamps })
export type Unit = z.infer<typeof unit>

export const taxCode = z.object({ id: z.string(), code: z.string(), name: z.string(), kind: z.string(), status: z.string(), ...stamps })
export type TaxCode = z.infer<typeof taxCode>
export const taxRate = z.object({ id: z.string(), taxCodeId: z.string(), effectiveFrom: z.string(), effectiveTo: z.string().nullable(), igstRate: z.string(), cgstRate: z.string(), sgstRate: z.string(), cessRate: z.string() })
export type TaxRate = z.infer<typeof taxRate>

export const item = z.object({
  id: z.string(), code: z.string(), name: z.string(), description: z.string().nullable(), itemType: z.string(), baseUomId: z.string(), hsnSacCode: z.string().nullable(), taxCodeId: z.string().nullable(),
  tracking: z.string(), isStocked: z.boolean(), isPurchasable: z.boolean(), isSellable: z.boolean(), isManufactured: z.boolean(), costingMethod: z.string().nullable().optional(), categoryId: z.string().nullable().optional(), brand: z.string().nullable().optional(), mrp: z.string().nullable().optional(), status: z.string(), ...stamps,
})
export type Item = z.infer<typeof item>
export const itemCategory = z.object({ id: z.string(), code: z.string(), name: z.string(), parentId: z.string().nullable(), noDiscount: z.boolean(), status: z.string(), version: z.number() })
export type ItemCategory = z.infer<typeof itemCategory>
export const itemBarcode = z.object({ id: z.string(), itemId: z.string(), barcode: z.string(), status: z.string() })
export type ItemBarcode = z.infer<typeof itemBarcode>
export const itemLookup = z.object({ item: item, matchedBy: z.string(), noDiscount: z.boolean() })
export type ItemLookup = z.infer<typeof itemLookup>

export const party = z.object({
  id: z.string(), code: z.string(), legalName: z.string(), tradeName: z.string().nullable(), isCustomer: z.boolean(), isSupplier: z.boolean(), isSubcontractor: z.boolean(), gstTreatment: z.string(),
  gstin: z.string().nullable(), pan: z.string().nullable(), currency: z.string(), paymentTermsId: z.string().nullable(), creditLimit: z.string().nullable(), status: z.string(), ...stamps,
})
export type Party = z.infer<typeof party>
export const address = z.object({ id: z.string(), partyId: z.string(), kind: z.string(), line1: z.string(), line2: z.string().nullable(), city: z.string(), stateCode: z.string(), pincode: z.string().nullable(), country: z.string(), isDefault: z.boolean(), status: z.string() })
export type Address = z.infer<typeof address>
export const paymentTerm = z.object({ id: z.string(), code: z.string(), name: z.string(), netDays: z.number(), status: z.string().optional() })
export type PaymentTerm = z.infer<typeof paymentTerm>

export const priceList = z.object({ id: z.string(), code: z.string(), name: z.string(), kind: z.string(), currency: z.string(), taxInclusive: z.boolean(), status: z.string(), ...stamps })
export type PriceList = z.infer<typeof priceList>
export const price = z.object({ id: z.string(), priceListId: z.string(), itemId: z.string(), uomId: z.string(), minQty: z.string(), price: z.string(), effectiveFrom: z.string(), effectiveTo: z.string().nullable() })
export type Price = z.infer<typeof price>

// ---- sales ----------------------------------------------------------------------------------------------------------------
export const invoiceLine = z.object({
  id: z.string(), lineNo: z.number(), itemId: z.string(), originalLineId: z.string().nullable(), description: z.string(), hsnSacCode: z.string().nullable(), quantity: z.string(), unitPrice: z.string(),
  discountPercent: z.string(), taxInclusive: z.boolean(), taxableValue: z.string(), taxCodeId: z.string().nullable(), igstRate: z.string(), cgstRate: z.string(), sgstRate: z.string(), cessRate: z.string(),
  cgstAmount: z.string(), sgstAmount: z.string(), igstAmount: z.string(), cessAmount: z.string(), lineTotal: z.string(), warehouseId: z.string().nullable(),
})
export type InvoiceLine = z.infer<typeof invoiceLine>

export const invoiceHeader = z.object({
  id: z.string(), companyId: z.string(), gstRegistrationId: z.string(), documentType: z.string(), invoiceNo: z.string(), invoiceDate: z.string(), customerId: z.string(), customerName: z.string(), customerGstin: z.string().nullable(),
  customerGstTreatment: z.string(), placeOfSupply: z.string(), supplyType: z.string(), taxPayment: z.string().nullable(), reverseCharge: z.boolean(), taxRegime: z.string(),
  taxableTotal: z.string(), cgstTotal: z.string(), sgstTotal: z.string(), igstTotal: z.string(), cessTotal: z.string(), roundOff: z.string(), grandTotal: z.string(),
  originalInvoiceId: z.string().nullable(), reason: z.string().nullable(), status: z.string(), cancelledAt: z.string().nullable(), cancelDate: z.string().nullable(), cancelReason: z.string().nullable(), dueDate: z.string().nullable(), createdAt: z.string(),
})
export type InvoiceHeader = z.infer<typeof invoiceHeader>
export const invoice = invoiceHeader.extend({ lines: z.array(invoiceLine), warnings: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()).optional() })
export type Invoice = z.infer<typeof invoice>

const taxRates = z.object({ igst: z.string(), cgst: z.string(), sgst: z.string(), cess: z.string() })
export const calculation = z.object({
  documentType: z.string(), invoiceDate: z.string(), dueDate: z.string().nullable(),
  customer: z.object({ id: z.string(), code: z.string(), name: z.string(), gstin: z.string().nullable(), gstTreatment: z.string() }),
  placeOfSupply: z.string(), supplyType: z.string(), taxRegime: z.string(), reverseCharge: z.boolean(),
  lines: z.array(z.object({ lineNo: z.number(), itemId: z.string(), description: z.string(), hsn: z.string().nullable(), quantity: z.string(), unitPrice: z.string(), discountPercent: z.string(), taxInclusive: z.boolean(), rates: taxRates, taxableValue: z.string(), cgst: z.string(), sgst: z.string(), igst: z.string(), cess: z.string(), lineTotal: z.string() })),
  totals: z.object({ taxable: z.string(), cgst: z.string(), sgst: z.string(), igst: z.string(), cess: z.string(), payable: z.string(), roundOff: z.string(), grandTotal: z.string() }),
})
export type Calculation = z.infer<typeof calculation>

export const allocation = z.object({ id: z.string(), invoiceId: z.string(), receiptId: z.string().nullable(), creditNoteId: z.string().nullable(), amount: z.string(), allocatedOn: z.string(), reversedOn: z.string().nullable() })
export const receipt = z.object({
  id: z.string(), receiptNo: z.string(), customerId: z.string(), receiptDate: z.string(), amount: z.string(), method: z.string(), depositAccountId: z.string(), reference: z.string().nullable(), notes: z.string().nullable(), status: z.string(),
  cancelReason: z.string().nullable(), createdAt: z.string(), allocations: z.array(allocation).optional(), unallocated: z.string().optional(),
})
export type Receipt = z.infer<typeof receipt>

export const position = z.object({
  customer: z.object({ id: z.string(), code: z.string(), name: z.string(), creditLimit: z.string().nullable() }), asOf: z.string(),
  openInvoices: z.array(z.object({ id: z.string(), number: z.string(), type: z.string(), date: z.string(), dueDate: z.string().nullable(), total: z.string(), outstanding: z.string(), daysOverdue: z.number() })),
  unapplied: z.array(z.object({ kind: z.string(), id: z.string(), number: z.string(), date: z.string(), amount: z.string() })),
  totalOutstanding: z.string(), totalUnapplied: z.string(), balance: z.string(), creditLimitExceeded: z.boolean(),
})
export type Position = z.infer<typeof position>

const buckets = { current: z.string(), days1to30: z.string(), days31to60: z.string(), days61to90: z.string(), over90: z.string(), total: z.string(), unapplied: z.string() }
export const ageing = z.object({ asOf: z.string(), customers: z.array(z.object({ customerId: z.string(), customerName: z.string(), ...buckets })), totals: z.object(buckets) })
export type Ageing = z.infer<typeof ageing>

export const statement = z.object({
  customer: z.object({ id: z.string(), code: z.string(), name: z.string() }), from: z.string(), to: z.string(), openingBalance: z.string(), closingBalance: z.string(),
  lines: z.array(z.object({ date: z.string(), kind: z.string(), number: z.string(), debit: z.string(), credit: z.string(), balance: z.string() })),
})
export type Statement = z.infer<typeof statement>

export const account = z.object({ id: z.string(), code: z.string(), name: z.string(), type: z.string(), isGroup: z.boolean(), controlKind: z.string().nullable(), status: z.string() })
export type Account = z.infer<typeof account>

// ---- purchasing -----------------------------------------------------------------------------------------------------------
export const purchaseOrderLine = z.object({ id: z.string(), orderId: z.string(), lineNo: z.number(), itemId: z.string(), description: z.string(), quantity: z.string(), quantityReceived: z.string(), quantityBilled: z.string(), unitPrice: z.string(), discountPercent: z.string(), taxCodeId: z.string().nullable(), warehouseId: z.string().nullable() })
export const purchaseOrderHeader = z.object({ id: z.string(), companyId: z.string(), poNo: z.string(), gstRegistrationId: z.string(), supplierId: z.string(), orderDate: z.string(), expectedDate: z.string().nullable(), supplierReference: z.string().nullable(), notes: z.string().nullable(), status: z.string(), createdAt: z.string() })
export const purchaseOrder = purchaseOrderHeader.extend({ lines: z.array(purchaseOrderLine) })
export type PurchaseOrderHeader = z.infer<typeof purchaseOrderHeader>
export type PurchaseOrder = z.infer<typeof purchaseOrder>

export const receiptLine = z.object({ id: z.string(), receiptId: z.string(), lineNo: z.number(), orderLineId: z.string().nullable(), itemId: z.string(), warehouseId: z.string(), quantity: z.string(), quantityBilled: z.string(), quantityReturned: z.string(), unitCost: z.string(), value: z.string() })
export const goodsReceiptHeader = z.object({ id: z.string(), companyId: z.string(), grnNo: z.string(), purchaseOrderId: z.string().nullable(), supplierId: z.string(), receiptDate: z.string(), supplierDeliveryNote: z.string().nullable(), notes: z.string().nullable(), status: z.string(), createdAt: z.string() })
export const goodsReceipt = goodsReceiptHeader.extend({ lines: z.array(receiptLine) })
export type GoodsReceiptHeader = z.infer<typeof goodsReceiptHeader>
export type GoodsReceipt = z.infer<typeof goodsReceipt>

export const grniLine = z.object({ supplierId: z.string(), grnNo: z.string(), receiptDate: z.string(), receiptId: z.string(), lineId: z.string(), itemId: z.string(), openQuantity: z.string(), unitCost: z.string(), openValue: z.string() }).passthrough()
export const grniReport = z.object({ asOf: z.string(), lines: z.array(grniLine), totalOpenValue: z.string() }).passthrough()
export type GrniLine = z.infer<typeof grniLine>

export const billLine = z.object({
  id: z.string(), lineNo: z.number(), itemId: z.string(), description: z.string(), hsnSacCode: z.string().nullable(), quantity: z.string(), unitPrice: z.string(), discountPercent: z.string(), taxableValue: z.string(),
  igstRate: z.string(), cgstRate: z.string(), sgstRate: z.string(), cgstAmount: z.string(), sgstAmount: z.string(), igstAmount: z.string(), cessAmount: z.string(), lineTotal: z.string(), itcEligible: z.boolean(), grnLineId: z.string().nullable(), priceVariance: z.string(),
})
export const bill = z.object({
  id: z.string(), companyId: z.string(), documentType: z.string(), billNo: z.string(), supplierInvoiceNo: z.string(), supplierInvoiceDate: z.string(), billDate: z.string(), dueDate: z.string().nullable(), gstRegistrationId: z.string(),
  supplierId: z.string(), supplierName: z.string(), supplierGstin: z.string().nullable(), placeOfSupply: z.string(), taxRegime: z.string(), reverseCharge: z.boolean(),
  taxableTotal: z.string(), cgstTotal: z.string(), sgstTotal: z.string(), igstTotal: z.string(), cessTotal: z.string(), itcTotal: z.string(), roundOff: z.string(), grandTotal: z.string(),
  matchStatus: z.string(), matchIssues: z.unknown().nullable(), matchOverrideReason: z.string().nullable(), status: z.string(), cancelDate: z.string().nullable(), cancelReason: z.string().nullable(), createdAt: z.string(), lines: z.array(billLine),
  preview: z.boolean().optional(),
})
export type Bill = z.infer<typeof bill>
export const billHeader = bill.omit({ lines: true, preview: true })
export type BillHeader = z.infer<typeof billHeader>

export const supplierPayment = z.object({ id: z.string(), paymentNo: z.string(), supplierId: z.string(), paymentDate: z.string(), amount: z.string(), method: z.string(), paidFromAccountId: z.string(), reference: z.string().nullable(), status: z.string(), cancelReason: z.string().nullable(), createdAt: z.string(), allocations: z.array(z.object({ id: z.string(), billId: z.string().nullable(), amount: z.string() })).optional(), unallocated: z.string().optional() })
export type SupplierPayment = z.infer<typeof supplierPayment>

export const supplierPosition = z.object({
  supplier: z.object({ id: z.string(), code: z.string(), name: z.string() }), asOf: z.string(),
  openBills: z.array(z.object({ id: z.string(), number: z.string(), supplierInvoiceNo: z.string().nullable(), date: z.string(), dueDate: z.string().nullable(), total: z.string(), outstanding: z.string(), daysOverdue: z.number() })),
  unapplied: z.array(z.object({ kind: z.string(), id: z.string(), number: z.string(), date: z.string(), amount: z.string() })),
  totalOutstanding: z.string(), totalUnapplied: z.string(), balance: z.string(),
})
export type SupplierPosition = z.infer<typeof supplierPosition>
export const payablesAgeing = z.object({ asOf: z.string(), suppliers: z.array(z.object({ supplierId: z.string(), supplierName: z.string(), ...buckets })), totals: z.object(buckets) })
export type PayablesAgeing = z.infer<typeof payablesAgeing>
export const supplierStatement = z.object({ supplier: z.object({ id: z.string(), code: z.string(), name: z.string() }), from: z.string(), to: z.string(), openingBalance: z.string(), closingBalance: z.string(), lines: z.array(z.object({ date: z.string(), kind: z.string(), number: z.string(), debit: z.string(), credit: z.string(), balance: z.string() })) })
export type SupplierStatement = z.infer<typeof supplierStatement>

// ---- approvals ------------------------------------------------------------------------------------------------------------
export const approvalDecision = z.object({ id: z.string(), decision: z.string(), decidedBy: z.string(), comment: z.string().nullable(), decidedAt: z.string() })
export const approvalRequest = z.object({
  id: z.string(), companyId: z.string(), requestNo: z.string(), documentType: z.enum(['purchase_order', 'payment', 'journal']), amount: z.string(), summary: z.string(), payload: z.record(z.string(), z.unknown()),
  requiredApprovals: z.number(), approvalsCount: z.number(), status: z.string(), requestedBy: z.string(), requestedAt: z.string(), decidedAt: z.string().nullable(), validUntil: z.string().nullable(),
  consumedAt: z.string().nullable(), consumedRefType: z.string().nullable(), consumedRefId: z.string().nullable(), expired: z.boolean(), decisions: z.array(approvalDecision).optional(),
})
export type ApprovalRequest = z.infer<typeof approvalRequest>

export const approvalPolicy = z.object({ id: z.string(), companyId: z.string(), documentType: z.string(), thresholdAmount: z.string(), requiredApprovals: z.number(), validDays: z.number(), status: z.string(), version: z.number() })
export type ApprovalPolicy = z.infer<typeof approvalPolicy>

// ---- inventory ------------------------------------------------------------------------------------------------------------
export const stockBalance = z.object({ warehouseId: z.string(), warehouseCode: z.string(), itemId: z.string(), itemCode: z.string(), itemName: z.string(), costingMethod: z.string(), quantity: z.string(), value: z.string(), averageCost: z.string() })
export type StockBalance = z.infer<typeof stockBalance>
export const stockLedgerRow = z.object({ id: z.string(), movementId: z.string(), lineNo: z.number(), warehouseId: z.string(), itemId: z.string(), postingDate: z.string(), quantity: z.string(), unitCost: z.string(), value: z.string(), balanceQuantity: z.string(), balanceValue: z.string(), movementNo: z.string(), movementType: z.string(), description: z.string() })
export type StockLedgerRow = z.infer<typeof stockLedgerRow>
export const movementHeader = z.object({ id: z.string(), movementNo: z.string(), movementType: z.string(), postingDate: z.string(), description: z.string(), sourceType: z.string(), sourceId: z.string().nullable(), journalEntryId: z.string().nullable(), postedAt: z.string() })
export type MovementHeader = z.infer<typeof movementHeader>
export const movement = movementHeader.extend({ lines: z.array(z.object({ id: z.string(), lineNo: z.number(), warehouseId: z.string(), itemId: z.string(), quantity: z.string(), unitCost: z.string(), value: z.string(), balanceQuantity: z.string() })) })
export type Movement = z.infer<typeof movement>
export const valuation = z.object({ asOf: z.string(), rows: z.array(z.object({ warehouseCode: z.string(), itemId: z.string(), itemCode: z.string(), itemName: z.string(), itemType: z.string(), costingMethod: z.string(), quantity: z.string(), value: z.string(), averageCost: z.string() })), totalValue: z.string() })
export type Valuation = z.infer<typeof valuation>
export const reconciliation = z.object({ asOf: z.string(), rows: z.array(z.object({ accountId: z.string(), code: z.string(), name: z.string(), stockValue: z.string(), glBalance: z.string(), difference: z.string(), reconciled: z.boolean() })), stockTotal: z.string(), glTotal: z.string(), difference: z.string(), reconciled: z.boolean() })
export type InventoryReconciliation = z.infer<typeof reconciliation>

export const transferLine = z.object({ id: z.string(), lineNo: z.number(), itemId: z.string(), quantity: z.string(), receivedQuantity: z.string() })
export const transferHeader = z.object({ id: z.string(), transferNo: z.string(), fromWarehouseId: z.string(), toWarehouseId: z.string(), transitWarehouseId: z.string().nullable(), status: z.string(), postingDate: z.string(), description: z.string(), version: z.number() })
export const transfer = transferHeader.extend({ lines: z.array(transferLine) })
export type TransferHeader = z.infer<typeof transferHeader>
export type Transfer = z.infer<typeof transfer>

export const countLine = z.object({ id: z.string(), itemId: z.string(), batchId: z.string().nullable(), snapshotQuantity: z.string(), countedQuantity: z.string().nullable(), unitCost: z.string().nullable(), systemQuantity: z.string().nullable(), variance: z.string().nullable() })
export const countHeader = z.object({ id: z.string(), countNo: z.string(), warehouseId: z.string(), countDate: z.string(), description: z.string(), status: z.string(), movementId: z.string().nullable(), version: z.number() })
export const stockCount = countHeader.extend({ lines: z.array(countLine) })
export type CountHeader = z.infer<typeof countHeader>
export type StockCount = z.infer<typeof stockCount>

// ---- accounting -----------------------------------------------------------------------------------------------------------
export const ledgerAccount = z.object({ id: z.string(), code: z.string(), name: z.string(), type: z.string(), parentId: z.string().nullable(), isGroup: z.boolean(), controlKind: z.string().nullable(), status: z.string(), version: z.number() })
export type LedgerAccount = z.infer<typeof ledgerAccount>

export const journalHeader = z.object({ id: z.string(), entryNo: z.string(), journalType: z.string(), sourceType: z.string(), postingDate: z.string(), description: z.string(), totalDebit: z.string(), totalCredit: z.string(), lineCount: z.number(), reversesEntryId: z.string().nullable(), reversalReason: z.string().nullable(), postedAt: z.string() })
export type JournalHeader = z.infer<typeof journalHeader>
export const journalEntry = journalHeader.extend({ lines: z.array(z.object({ id: z.string(), lineNo: z.number(), accountId: z.string(), debit: z.string(), credit: z.string(), description: z.string().nullable() })), reversedBy: z.string().nullable().optional() })
export type JournalEntry = z.infer<typeof journalEntry>

export const accountingPeriod = z.object({ id: z.string(), periodNo: z.number(), name: z.string(), startDate: z.string(), endDate: z.string(), status: z.string(), version: z.number() })
export type AccountingPeriod = z.infer<typeof accountingPeriod>
export const fiscalYearWithPeriods = z.object({ id: z.string(), label: z.string(), startDate: z.string(), endDate: z.string(), periods: z.array(accountingPeriod) })
export type FiscalYearWithPeriods = z.infer<typeof fiscalYearWithPeriods>
export const yearClosing = z.object({ id: z.string(), fiscalYearId: z.string(), closingEntryId: z.string().nullable(), netProfit: z.string(), status: z.string(), closedAt: z.string(), reopenedAt: z.string().nullable(), reopenReason: z.string().nullable() })
export type YearClosing = z.infer<typeof yearClosing>

export const trialBalance = z.object({
  from: z.string(), to: z.string(), balanced: z.boolean(),
  rows: z.array(z.object({ accountId: z.string(), code: z.string(), name: z.string(), type: z.string(), openingDebit: z.string(), openingCredit: z.string(), debit: z.string(), credit: z.string(), closingDebit: z.string(), closingCredit: z.string() })),
  totals: z.object({ openingDebit: z.string(), openingCredit: z.string(), debit: z.string(), credit: z.string(), closingDebit: z.string(), closingCredit: z.string() }),
})
export type TrialBalance = z.infer<typeof trialBalance>
export const accountLedger = z.object({ account: z.object({ id: z.string(), code: z.string(), name: z.string() }), from: z.string(), to: z.string(), openingBalance: z.string(), hasMore: z.boolean(), lines: z.array(z.object({ entryId: z.string(), entryNo: z.string(), postingDate: z.string(), description: z.string().nullable(), debit: z.string(), credit: z.string(), balance: z.string() })) })
export type AccountLedger = z.infer<typeof accountLedger>

const stLine = z.object({ code: z.string(), label: z.string(), amount: z.string(), accounts: z.array(z.object({ accountId: z.string(), code: z.string(), name: z.string(), amount: z.string() })) })
export const profitLoss = z.object({ from: z.string(), to: z.string(), lines: z.array(stLine), revenueFromOperations: z.string(), otherIncome: z.string(), totalRevenue: z.string(), totalExpenses: z.string(), profitBeforeTax: z.string(), taxExpense: z.string(), profitForThePeriod: z.string(), unmappedAccounts: z.array(z.string()) })
export type ProfitLoss = z.infer<typeof profitLoss>
export const balanceSheet = z.object({
  asOf: z.string(), balanced: z.boolean(), difference: z.string(), unmappedAccounts: z.array(z.string()),
  equityAndLiabilities: z.object({ lines: z.array(stLine), profitAndLossAccount: z.string(), shareholdersFunds: z.string(), total: z.string() }),
  assets: z.object({ lines: z.array(stLine), total: z.string() }),
})
export type BalanceSheet = z.infer<typeof balanceSheet>
export const cashFlow = z.object({ from: z.string(), to: z.string(), operating: z.object({ profitForThePeriod: z.string(), depreciation: z.string(), changeInWorkingCapital: z.string(), net: z.string() }), investing: z.object({ net: z.string() }), financing: z.object({ borrowings: z.string(), equityOtherThanProfit: z.string(), net: z.string() }), netChangeInCash: z.string(), openingCash: z.string(), closingCash: z.string(), reconciled: z.boolean() })
export type CashFlow = z.infer<typeof cashFlow>

// ---- bank reconciliation --------------------------------------------------------------------------------------------------
export const bankAccount = z.object({ id: z.string(), accountId: z.string(), name: z.string(), bankName: z.string().nullable(), accountRef: z.string().nullable(), clearedThrough: z.string().nullable(), status: z.string(), version: z.number() })
export type BankAccount = z.infer<typeof bankAccount>
export const bankStatement = z.object({ id: z.string(), statementNo: z.string(), periodFrom: z.string(), periodTo: z.string(), openingBalance: z.string(), closingBalance: z.string(), lineCount: z.number(), status: z.string() })
export type BankStatement = z.infer<typeof bankStatement>
export const bankLine = z.object({ id: z.string(), statementId: z.string(), lineNo: z.number(), lineDate: z.string(), description: z.string(), reference: z.string().nullable(), amount: z.string(), status: z.string(), ignoreReason: z.string().nullable() })
export type BankLine = z.infer<typeof bankLine>
export const bankCandidate = z.object({ journalLineId: z.string(), entryNo: z.string(), postingDate: z.string(), amount: z.string(), description: z.string().nullable(), daysApart: z.number() })
export type BankCandidate = z.infer<typeof bankCandidate>
const reconItem = z.object({ amount: z.string(), description: z.string().nullable().optional(), postingDate: z.string().optional(), entryNo: z.string().optional(), date: z.string().optional(), statementLineId: z.string().optional(), journalLineId: z.string().optional() }).passthrough()
export const bankReconciliation = z.object({
  asOf: z.string(), balancePerBooks: z.string(), expectedStatementBalance: z.string(), difference: z.string().nullable(), reconciled: z.boolean(), fullyMatched: z.boolean(), clearedThrough: z.string().nullable(),
  depositsInTransit: z.object({ total: z.string(), items: z.array(reconItem) }), outstandingPayments: z.object({ total: z.string(), items: z.array(reconItem) }),
  bankItemsNotInBooks: z.object({ total: z.string(), items: z.array(reconItem) }), ignoredBankItems: z.object({ total: z.string(), items: z.array(reconItem) }),
  statement: z.object({ statementNo: z.string(), asOf: z.string(), closingBalance: z.string() }).nullable(),
})
export type BankReconciliation = z.infer<typeof bankReconciliation>

// ---- GST returns (shapes follow the GSTN offline-tool JSON the server produces) --------------------------------------------
const gstAmounts = z.object({ txval: z.string(), iamt: z.string(), camt: z.string(), samt: z.string(), csamt: z.string() })
const gstItem = gstAmounts.extend({ rt: z.string() })
const gstDoc = z.object({ inum: z.string().nullable().optional(), idt: z.string().nullable().optional(), val: z.string(), pos: z.string(), rchrg: z.string(), items: z.array(gstItem) }).passthrough()
export const gstr1 = z.object({
  gstin: z.string(), period: z.string(), from: z.string(), to: z.string(),
  b2b: z.array(z.object({ ctin: z.string(), inv: z.array(gstDoc) })),
  b2cl: z.array(z.object({ pos: z.string(), inv: z.array(gstDoc) })),
  b2cs: z.array(gstAmounts.extend({ sply_ty: z.string(), pos: z.string(), rt: z.string() })),
  exp: z.array(z.object({ exp_typ: z.string(), inv: z.array(gstDoc) })),
  cdnr: z.array(z.object({ ctin: z.string(), nt: z.array(gstDoc.extend({ nt_num: z.string(), nt_dt: z.string(), ntty: z.string() })) })),
  cdnur: z.array(gstDoc.extend({ nt_num: z.string(), nt_dt: z.string(), ntty: z.string(), typ: z.string() })),
  nil: z.record(z.string(), z.string()),
  hsn: z.array(gstAmounts.extend({ hsn_sc: z.string(), uqc: z.string(), rt: z.string(), qty: z.string() })),
  doc_issue: z.array(z.object({ doc_typ: z.string(), from: z.string(), to: z.string(), totnum: z.number(), cancel: z.number(), net_issue: z.number() })),
  summary: z.record(z.string(), gstAmounts),
})
export type Gstr1 = z.infer<typeof gstr1>
const t4 = z.object({ igst: z.string(), cgst: z.string(), sgst: z.string(), cess: z.string() })
export const gstr3b = z.object({
  gstin: z.string(), period: z.string(), from: z.string(), to: z.string(),
  sup_details: z.object({ osup_det: gstAmounts, osup_zero: gstAmounts, osup_nil_exmp: z.object({ txval: z.string() }), isup_rev: gstAmounts, osup_nongst: z.object({ txval: z.string() }), outward_reverse_charge_by_recipient: z.object({ txval: z.string() }) }),
  inter_sup: z.object({ unreg_details: z.array(z.object({ pos: z.string(), txval: z.string(), iamt: z.string() })), comp_details: z.array(z.object({ pos: z.string(), txval: z.string(), iamt: z.string() })) }),
  itc_elg: z.object({ itc_avl: z.object({ impg_and_imps: gstAmounts, isrc: gstAmounts, oth: gstAmounts }), itc_rev: z.object({ oth: gstAmounts }), itc_net: gstAmounts, itc_inelg: z.object({ oth: gstAmounts }) }),
  inward_sup: z.object({ isup_details: z.object({ inter: z.string(), intra: z.string() }) }),
  tax_pmt: z.object({ liability: t4.extend({ reverse_charge: t4 }), paid_through_itc: t4, payable_in_cash: t4, itc_unused: t4 }),
})
export type Gstr3b = z.infer<typeof gstr3b>
export const itcRegister = z.object({
  period: z.string(),
  documents: z.array(z.object({ document: z.string(), type: z.string(), date: z.string(), supplierGstin: z.string().nullable(), supplierTreatment: z.string(), reverseCharge: z.boolean(), taxable: z.string(), igst: z.string(), cgst: z.string(), sgst: z.string(), cess: z.string(), itcAvailable: z.string(), itcBlocked: z.string() })),
  totals: z.object({ itcAvailable: z.string(), itcBlocked: z.string() }),
})
export type ItcRegister = z.infer<typeof itcRegister>
export const cmp08 = z.object({
  gstin: z.string(), quarter: z.string(), from: z.string(), to: z.string(),
  outward: z.object({ turnover: z.string(), ratePercent: z.string(), central: z.string(), state: z.string(), integrated: z.string(), tax: z.string() }),
  inwardReverseCharge: z.object({ taxable: z.string(), integrated: z.string(), central: z.string(), state: z.string(), cess: z.string() }),
  totalPayable: z.string(),
})
export type Cmp08 = z.infer<typeof cmp08>
export const returnSettings = z.object({ gstRegistrationId: z.string(), registrationType: z.string(), compositionRate: z.string().nullable() })

// ---- manufacturing --------------------------------------------------------------------------------------------------------
export const mfgSettings = z.object({ companyId: z.string(), wipAccountId: z.string().nullable().optional(), labourAbsorbedAccountId: z.string().nullable().optional(), overheadAbsorbedAccountId: z.string().nullable().optional(), productionVarianceAccountId: z.string().nullable().optional(), subcontractClearingAccountId: z.string().nullable().optional(), version: z.number().optional() })
export type MfgSettings = z.infer<typeof mfgSettings>
export const workCentre = z.object({ id: z.string(), companyId: z.string(), code: z.string(), name: z.string(), labourRatePerHour: z.string(), machineRatePerHour: z.string(), overheadRatePerHour: z.string(), status: z.string(), version: z.number() })
export type WorkCentre = z.infer<typeof workCentre>
export const bomHeader = z.object({ id: z.string(), itemId: z.string(), bomNo: z.string(), version: z.number(), description: z.string().nullable(), baseQuantity: z.string(), effectiveFrom: z.string(), effectiveTo: z.string().nullable(), status: z.string() })
export type BomHeader = z.infer<typeof bomHeader>
export const bom = bomHeader.extend({
  lines: z.array(z.object({ id: z.string(), lineNo: z.number(), itemId: z.string(), quantity: z.string(), scrapPercent: z.string(), notes: z.string().nullable() })),
  operations: z.array(z.object({ id: z.string(), opNo: z.number(), name: z.string(), workCentreId: z.string(), setupHours: z.string(), runHours: z.string() })),
})
export type Bom = z.infer<typeof bom>
export interface RollupNode { itemId: string; itemCode: string; quantity: string; unitCost: string; value: string; source: string; children: RollupNode[] }
const rollupNode: z.ZodType<RollupNode> = z.lazy(() => z.object({ itemId: z.string(), itemCode: z.string(), quantity: z.string(), unitCost: z.string(), value: z.string(), source: z.string(), children: z.array(rollupNode) }))
export const rollup = z.object({ quantity: z.string(), tree: z.array(rollupNode), material: z.string(), labour: z.string(), overhead: z.string(), total: z.string(), unitCost: z.string(), complete: z.boolean(), itemsWithoutCost: z.array(z.unknown()) })
export type Rollup = z.infer<typeof rollup>
export const explosion = z.object({ rawRequirements: z.array(z.object({ itemId: z.string(), itemCode: z.string(), quantity: z.string() })) })
export type Explosion = z.infer<typeof explosion>
export const workOrderHeader = z.object({
  id: z.string(), woNo: z.string(), itemId: z.string(), bomId: z.string().nullable(), plannedQuantity: z.string(), producedQuantity: z.string(), scrapQuantity: z.string(),
  outputWarehouseId: z.string(), materialsWarehouseId: z.string(), plannedStart: z.string().nullable(), dueDate: z.string().nullable(), notes: z.string().nullable(), status: z.string(),
})
export type WorkOrderHeader = z.infer<typeof workOrderHeader>
export const workOrder = workOrderHeader.extend({
  materials: z.array(z.object({ id: z.string(), lineNo: z.number(), itemId: z.string(), requiredQuantity: z.string(), issuedQuantity: z.string(), returnedQuantity: z.string() })),
  operations: z.array(z.object({ id: z.string(), opNo: z.number(), name: z.string(), workCentreId: z.string(), plannedHours: z.string(), actualHours: z.string() })),
  transactions: z.array(z.object({ id: z.string(), kind: z.string(), txnDate: z.string(), itemId: z.string().nullable(), quantity: z.string().nullable(), hours: z.string().nullable(), value: z.string(), note: z.string().nullable() })),
  cost: z.object({ materials: z.string(), labour: z.string(), overhead: z.string(), subcontract: z.string(), finishedGoods: z.string(), residualCleared: z.string(), wip: z.string() }),
})
export type WorkOrder = z.infer<typeof workOrder>
const ratio = z.string().nullable()
export const woVariance = z.object({
  workOrderId: z.string(), woNo: z.string(), status: z.string(), plannedQuantity: z.string(), producedQuantity: z.string(), scrapQuantity: z.string(),
  materials: z.array(z.object({ itemCode: z.string(), requiredQuantity: z.string(), netIssuedQuantity: z.string(), plannedValue: z.string(), actualValue: z.string(), usageVariance: z.string(), usageVariancePercent: ratio })),
  operations: z.array(z.object({ opNo: z.number(), name: z.string(), plannedHours: z.string(), actualHours: z.string(), hoursVariance: z.string(), hoursOver: z.boolean(), plannedValue: z.string(), actualValue: z.string(), efficiencyVariance: z.string(), efficiencyVariancePercent: ratio })),
  subcontractCharges: z.string(),
  totals: z.object({ planned: z.string(), actual: z.string(), variance: z.string(), variancePercent: ratio, usage: z.string(), efficiency: z.string() }),
  yield: z.object({ percent: ratio, shortfallQuantity: z.string(), scrapRatePercent: ratio }),
  unitCost: z.object({ actual: z.string().nullable(), planned: z.string().nullable() }),
})
export type WoVariance = z.infer<typeof woVariance>
export const variances = z.object({
  from: z.string(), to: z.string(),
  workOrders: z.array(z.object({ workOrderId: z.string(), woNo: z.string(), itemId: z.string(), planned: z.string(), actual: z.string(), variance: z.string(), usage: z.string(), efficiency: z.string(), yieldPercent: ratio })),
  totals: z.object({ planned: z.string(), actual: z.string(), variance: z.string(), usage: z.string(), efficiency: z.string() }),
})
export type Variances = z.infer<typeof variances>
export const wipReconciliation = z.object({ asOf: z.string(), workOrders: z.array(z.object({ id: z.string(), woNo: z.string(), status: z.string(), wip: z.string() })), documents: z.string(), ledger: z.string(), difference: z.string(), reconciled: z.boolean() })
export type WipReconciliation = z.infer<typeof wipReconciliation>
export const subcontractHeader = z.object({ id: z.string(), workOrderId: z.string(), subcontractorId: z.string(), jobworkerWarehouseId: z.string(), sourceWarehouseId: z.string(), ratePerUnit: z.string(), firstSentOn: z.string().nullable(), returnDueDate: z.string().nullable(), status: z.string() })
export type SubcontractHeader = z.infer<typeof subcontractHeader>
export const subcontractOrder = subcontractHeader.extend({
  workOrder: workOrder,
  challans: z.array(z.object({ id: z.string(), challanNo: z.string(), kind: z.string(), challanDate: z.string(), vehicleNo: z.string().nullable(), ewayBillNo: z.string().nullable(), lines: z.array(z.object({ itemId: z.string(), quantity: z.string() })) })),
  pending: z.array(z.object({ itemId: z.string(), quantity: z.string() }).passthrough()),
})
export type SubcontractOrder = z.infer<typeof subcontractOrder>
export const subcontractPending = z.object({ asOf: z.string(), overdueCount: z.number(), orders: z.array(z.object({ orderId: z.string(), woNo: z.string(), subcontractorId: z.string(), firstSentOn: z.string(), returnDueDate: z.string().nullable(), daysOut: z.number(), overdue: z.boolean(), items: z.array(z.object({ itemId: z.string(), quantity: z.string() })) })) })
export type SubcontractPending = z.infer<typeof subcontractPending>

// ---- payroll --------------------------------------------------------------------------------------------------------------
const acct = z.string().nullable().optional()
export const payrollSettings = z.object({ companyId: z.string(), salaryExpenseAccountId: acct, employerCostAccountId: acct, salaryPayableAccountId: acct, pfPayableAccountId: acct, esiPayableAccountId: acct, ptPayableAccountId: acct, tdsPayableAccountId: acct, otherDeductionsAccountId: acct })
export type PayrollSettings = z.infer<typeof payrollSettings>
const slabRow = z.object({ from: z.string(), to: z.string().nullable(), ratePercent: z.string().nullable(), fixedAmount: z.string().nullable() })
export type SlabRow = z.infer<typeof slabRow>
export const payrollRules = z.object({
  date: z.string(), stateCode: z.string().nullable().optional(),
  pf: z.object({ employeePercent: z.string(), employerPercent: z.string(), ceiling: z.string() }).nullable().optional(),
  esi: z.object({ employeePercent: z.string(), employerPercent: z.string(), ceiling: z.string() }).nullable().optional(),
  regimes: z.array(z.object({ regime: z.string(), missing: z.array(z.string()), tdsSlabs: z.number(), ptSlabs: z.number(), tdsSlabDetail: z.array(slabRow).optional(), ptSlabDetail: z.array(slabRow).optional(), standardDeduction: z.string().nullable().optional(), rebateLimit: z.string().nullable().optional(), rebateAmount: z.string().nullable().optional(), cessPercent: z.string().nullable().optional() })),
})
export type PayrollRules = z.infer<typeof payrollRules>
export const payComponent = z.object({ id: z.string(), code: z.string(), name: z.string(), kind: z.string(), calculation: z.string(), percent: z.string().nullable(), isTaxable: z.boolean(), pfWage: z.boolean(), esiWage: z.boolean(), status: z.string() })
export type PayComponent = z.infer<typeof payComponent>
export const employee = z.object({
  id: z.string(), employeeNo: z.string(), kind: z.string(), fullName: z.string(), pan: z.string().nullable(), uan: z.string().nullable(), esiNo: z.string().nullable(), stateCode: z.string(), dateOfJoining: z.string(), dateOfLeaving: z.string().nullable(),
  payBasis: z.string(), taxRegime: z.string(), tdsRatePercent: z.string().nullable(), pfApplicable: z.boolean(), esiApplicable: z.boolean(), ptApplicable: z.boolean(), bankAccountRef: z.string().nullable(), status: z.string(), version: z.number(),
})
export type Employee = z.infer<typeof employee>
export const salaryStructure = z.object({ id: z.string(), effectiveFrom: z.string(), basic: z.string(), lines: z.array(z.object({ componentId: z.string(), amount: z.string().nullable() })) })
export type SalaryStructure = z.infer<typeof salaryStructure>
export const payrollInput = z.object({ employeeId: z.string(), period: z.string(), lopDays: z.string(), unitsWorked: z.string().nullable(), bonus: z.string(), otherDeduction: z.string(), notes: z.string().nullable() })
export type PayrollInput = z.infer<typeof payrollInput>
export const payslip = z.object({
  id: z.string(), runId: z.string(), employeeId: z.string(), employeeNo: z.string(), employeeName: z.string(), kind: z.string(), period: z.string(), gross: z.string(), pfEmployee: z.string(), pfEmployer: z.string(), esiEmployee: z.string(), esiEmployer: z.string(),
  professionalTax: z.string(), tds: z.string(), otherDeductions: z.string(), net: z.string(),
  detail: z.object({ bonus: z.string().optional(), paidDays: z.string().optional(), payBasis: z.string().optional(), employerCost: z.string().optional(), earnings: z.array(z.object({ code: z.string(), name: z.string(), amount: z.string() })).optional(), deductions: z.array(z.object({ code: z.string(), name: z.string(), amount: z.string() })).optional() }).passthrough(),
})
export type Payslip = z.infer<typeof payslip>
export const payrollRunHeader = z.object({
  id: z.string(), runNo: z.string(), period: z.string(), payDate: z.string(), grossTotal: z.string(), employeeDeductions: z.string(), netTotal: z.string(), employerCostTotal: z.string(), pfTotal: z.string(), esiTotal: z.string(), ptTotal: z.string(), tdsTotal: z.string(),
  status: z.string(), paidOn: z.string().nullable(), cancelReason: z.string().nullable(),
})
export type PayrollRunHeader = z.infer<typeof payrollRunHeader>
export const payrollRun = payrollRunHeader.extend({ payslips: z.array(payslip) })
export type PayrollRun = z.infer<typeof payrollRun>
export const payrollLiabilities = z.object({ periods: z.array(z.object({ period: z.string(), pf: z.string(), esi: z.string(), pt: z.string(), tds: z.string() })) })
export type PayrollLiabilities = z.infer<typeof payrollLiabilities>
export const remittance = z.object({ id: z.string(), remittanceNo: z.string(), kind: z.string(), period: z.string(), remittedOn: z.string(), amount: z.string(), reference: z.string().nullable() })
export const payrollSeed = z.object({ effectiveFrom: z.string(), rates: z.number(), slabSets: z.array(z.string()) })

// ---- point of sale --------------------------------------------------------------------------------------------------------
export const POS_METHODS = ['cash', 'upi', 'card', 'bank_transfer', 'cheque', 'other'] as const
export const posSettings = z.object({
  settings: z.object({ companyId: z.string(), walkInCustomerId: z.string().nullable().optional(), cashVarianceAccountId: z.string().nullable().optional() }).nullable(),
  paymentAccounts: z.array(z.object({ method: z.string(), accountId: z.string() })),
})
export type PosSettings = z.infer<typeof posSettings>
export const posTerminal = z.object({ id: z.string(), code: z.string(), name: z.string(), gstRegistrationId: z.string(), businessLocationId: z.string(), warehouseId: z.string(), status: z.string() })
export type PosTerminal = z.infer<typeof posTerminal>
const shiftSummary = z.object({ salesCount: z.number(), salesTotal: z.string(), returnsCount: z.number(), returnsTotal: z.string(), paymentsReceived: z.record(z.string(), z.string()), refundsPaid: z.record(z.string(), z.string()), expectedCash: z.string(), openingCash: z.string() })
export const posShift = z.object({ id: z.string(), terminalId: z.string(), shiftNo: z.string(), openedAt: z.string(), openingCash: z.string(), status: z.string(), closedAt: z.string().nullable(), countedCash: z.string().nullable(), expectedCash: z.string().nullable(), variance: z.string().nullable(), summary: shiftSummary.optional() })
export type PosShift = z.infer<typeof posShift>
const posPayment = z.object({ method: z.string(), amount: z.string(), tendered: z.string().nullable().optional(), reference: z.string().nullable().optional() })
export const posSaleResult = z.object({ id: z.string(), kind: z.string(), shiftId: z.string(), invoice: invoice.optional(), creditNote: invoice.optional(), payments: z.array(posPayment), changeDue: z.string().optional() })
export type PosSaleResult = z.infer<typeof posSaleResult>
export const posSaleHeader = z.object({ id: z.string(), kind: z.string(), documentNo: z.string(), total: z.string(), createdAt: z.string(), shiftId: z.string() })
export type PosSaleHeader = z.infer<typeof posSaleHeader>
export const posSaleDetail = z.object({ id: z.string(), kind: z.string(), document: invoice.nullable(), payments: z.array(posPayment) })
export type PosSaleDetail = z.infer<typeof posSaleDetail>
export const posDevice = z.object({ id: z.string(), terminalId: z.string(), name: z.string(), status: z.string(), lastSyncAt: z.string().nullable() })
export type PosDevice = z.infer<typeof posDevice>
export const posCatalogue = z.object({
  serverTime: z.string(), walkInCustomerId: z.string().nullable(), paymentMethods: z.array(z.string()),
  items: z.array(z.object({ id: z.string(), code: z.string(), name: z.string(), hsn: z.string().nullable(), taxCodeId: z.string().nullable(), itemType: z.string(), stocked: z.boolean(), tracking: z.string(), status: z.string(), mrp: z.string().nullable().optional(), categoryId: z.string().nullable().optional(), noDiscount: z.boolean().optional() })),
  barcodes: z.array(z.object({ itemId: z.string(), barcode: z.string() })).optional(),
})
export type PosCatalogue = z.infer<typeof posCatalogue>
export const syncResult = z.object({ deviceId: z.string(), received: z.number(), applied: z.number(), duplicates: z.number(), rejected: z.number(), results: z.array(z.object({ clientId: z.string(), status: z.string(), saleId: z.string().optional(), reason: z.string().optional(), code: z.string().optional(), message: z.string().optional() }).passthrough()) })
export type SyncResult = z.infer<typeof syncResult>

// ---- administration ---------------------------------------------------------------------------------------------------------
export const adminUser = z.object({ id: z.string(), email: z.string(), displayName: z.string(), status: z.string(), mfaEnabled: z.boolean(), lastLoginAt: z.string().nullable(), roleIds: z.array(z.string()).optional(), version: z.number() })
export type AdminUser = z.infer<typeof adminUser>
export const role = z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), isSystem: z.boolean(), permissions: z.array(z.string()), version: z.number() })
export type Role = z.infer<typeof role>
export const apiKey = z.object({ id: z.string(), name: z.string(), keyPrefix: z.string(), permissions: z.array(z.string()), expiresAt: z.string().nullable(), revokedAt: z.string().nullable(), lastUsedAt: z.string().nullable(), createdAt: z.string() })
export type ApiKey = z.infer<typeof apiKey>
export const auditEvent = z.object({ id: z.string(), occurredAt: z.string(), actorType: z.string(), actorId: z.string().nullable(), action: z.string(), entityType: z.string().nullable(), entityId: z.string().nullable(), outcome: z.string(), requestId: z.string().nullable(), ipAddress: z.string().nullable(), details: z.unknown() })
export type AuditEvent = z.infer<typeof auditEvent>

// ---- quotes and sales orders -------------------------------------------------------------------------------------------------
export const quoteHeader = z.object({ id: z.string(), quoteNo: z.string(), customerId: z.string(), quoteDate: z.string(), validUntil: z.string(), notes: z.string().nullable(), estimatedTaxable: z.string(), estimatedTax: z.string(), estimatedTotal: z.string(), status: z.string(), orderId: z.string().nullable(), gstRegistrationId: z.string() })
export type QuoteHeader = z.infer<typeof quoteHeader>
export const quote = quoteHeader.extend({ lines: z.array(z.object({ id: z.string(), lineNo: z.number(), itemId: z.string(), description: z.string().nullable(), quantity: z.string(), unitPrice: z.string(), discountPercent: z.string(), estimatedTaxable: z.string(), estimatedTotal: z.string() })) })
export type Quote = z.infer<typeof quote>
export const orderHeader = z.object({ id: z.string(), orderNo: z.string(), customerId: z.string(), orderDate: z.string(), customerReference: z.string().nullable(), reserveStock: z.boolean(), quoteId: z.string().nullable(), status: z.string(), gstRegistrationId: z.string() })
export type OrderHeader = z.infer<typeof orderHeader>
export const salesOrder = orderHeader.extend({
  lines: z.array(z.object({ id: z.string(), lineNo: z.number(), itemId: z.string(), description: z.string().nullable(), quantity: z.string(), quantityInvoiced: z.string(), unitPrice: z.string(), discountPercent: z.string(), taxInclusive: z.boolean() })),
  invoices: z.array(z.object({ id: z.string(), invoiceNo: z.string(), status: z.string(), grandTotal: z.string() })).optional(),
})
export type SalesOrder = z.infer<typeof salesOrder>

// ---- landed cost ---------------------------------------------------------------------------------------------------------
export const landedCostHeader = z.object({ id: z.string(), voucherNo: z.string(), voucherDate: z.string(), description: z.string(), basis: z.string(), totalAmount: z.string(), status: z.string(), cancelReason: z.string().nullable() })
export type LandedCostHeader = z.infer<typeof landedCostHeader>
export const landedCost = landedCostHeader.extend({
  charges: z.array(z.object({ id: z.string(), kind: z.string(), description: z.string().nullable(), amount: z.string(), accountId: z.string() })),
  lines: z.array(z.object({ id: z.string(), grnLineId: z.string(), itemId: z.string(), quantity: z.string(), basisValue: z.string(), allocated: z.string(), capitalised: z.string(), expensed: z.string() })),
})
export type LandedCost = z.infer<typeof landedCost>

// ---- batches, serial numbers, reservations ---------------------------------------------------------------------------------
export const batch = z.object({ id: z.string(), itemId: z.string(), batchNo: z.string(), manufactureDate: z.string().nullable(), expiryDate: z.string().nullable(), status: z.string() })
export type Batch = z.infer<typeof batch>
export const serial = z.object({ id: z.string(), itemId: z.string(), serialNo: z.string(), warehouseId: z.string().nullable(), status: z.string() })
export type Serial = z.infer<typeof serial>
export const reservation = z.object({ id: z.string(), warehouseId: z.string(), itemId: z.string(), batchId: z.string().nullable(), quantity: z.string(), consumedQuantity: z.string(), status: z.string(), referenceType: z.string(), referenceId: z.string(), expiresAt: z.string().nullable(), createdAt: z.string() })
export type Reservation = z.infer<typeof reservation>
export const availability = z.object({ itemId: z.string(), warehouses: z.array(z.object({ warehouseId: z.string(), onHand: z.string(), reserved: z.string(), available: z.string() })) })
export type Availability = z.infer<typeof availability>
export const stockSettings = z.object({ companyId: z.string(), adjustmentAccountId: z.string().nullable(), openingBalanceAccountId: z.string().nullable() })
export type StockSettings = z.infer<typeof stockSettings>
