import type { PartyType } from '../postings'

/**
 * Tax module — see docs/MODULES.md. Builds on the accounting module (chart of accounts, ledger, vouchers) without
 * duplicating it: a bank account is a chart account the phone knows more about; depreciation, loan repayments and
 * TDS/TCS post their own documents through posting rules, exactly like any other module's financial documents.
 */

// ───────────────────────────── bank & cash accounts ─────────────────────────────

export type BankAccountKind = 'bank' | 'cash'

/** A specific bank or cash account, backed by its own account in the chart (a child of the 'bank' / 'cash' well-known account). */
export interface BankAccount {
  id: string
  name: string
  kind: BankAccountKind
  bankName?: string
  accountNumber?: string
  ifsc?: string
  branchName?: string
  /** The chart-of-accounts account this bank account posts to. Created alongside it. */
  accountId: string
  openingBalance: number
  openingDate?: number
  active: boolean
  branchId?: string
  createdAt: number
}

// ───────────────────────────── reconciliation ─────────────────────────────

export type ReconcileKind = 'bank' | 'gateway'

/**
 * One ledger line matched to a line on an outside statement (a bank statement or a payment-gateway settlement report).
 * The ledger line itself is never stored — it is found again from `sourceColl` + `sourceId` + `lineIndex` (the position
 * of this account's line inside that document's posting), so a mark never drifts from the books.
 */
export interface ReconciliationMark {
  id: string
  kind: ReconcileKind
  /** Which bank account this reconciles (bank kind only). */
  bankAccountId?: string
  sourceColl: string
  sourceId: string
  lineIndex: number
  /** What the ledger line was worth, signed debit − credit, at the time it was marked (so a screen can show it without rebuilding the ledger). */
  entryAmount: number
  entryDate: number
  statementDate: number
  statementRef: string
  note?: string
  reconciledBy: string
  reconciledAt: number
  branchId?: string
}

// ───────────────────────────── fixed assets & depreciation ─────────────────────────────

export type DepreciationMethod = 'slm' | 'wdv'

export interface FixedAsset {
  id: string
  code: string
  name: string
  category: string
  purchaseDate: number
  cost: number
  salvageValue: number
  /** Useful life in months (SLM) or the basis the WDV rate was chosen from. */
  usefulLifeMonths: number
  method: DepreciationMethod
  /** WDV only: the annual rate. Missing = worked out from the useful life (1 − (salvage/cost)^(1/years)). */
  wdvRatePct?: number
  costCentreId?: string
  vendor?: string
  invoiceRef?: string
  status: 'active' | 'disposed'
  disposedAt?: number
  disposalAmount?: number
  note?: string
  branchId?: string
  createdBy: string
  createdAt: number
}

/** One run of depreciation posted for an asset, covering a period. Never edited — a mistake is fixed by a reversing run. */
export interface DepreciationRun {
  id: string
  assetId: string
  periodStart: number
  periodEnd: number
  amount: number
  accumulatedBefore: number
  accumulatedAfter: number
  bookValueAfter: number
  reversesId?: string
  branchId?: string
  createdBy: string
  createdAt: number
}

// ───────────────────────────── TDS / TCS ─────────────────────────────

export type TaxDeductionKind = 'tds' | 'tcs'

/** A section of the Income Tax Act with the rate this business uses for it — a reference table, not advice. */
export interface TaxSection {
  id: string
  kind: TaxDeductionKind
  section: string
  description: string
  ratePct: number
  thresholdAmount?: number
  active: boolean
}

/**
 * A TDS deducted from a payment to someone, or TCS collected from a buyer — tracked and reported, not a new payment
 * system: posts the same net-of-tax entry a payment voucher would, plus the amount withheld for the government.
 */
export interface TaxDeduction {
  id: string
  no: string
  kind: TaxDeductionKind
  date: number
  sectionId?: string
  section: string
  ratePct: number
  partyType: PartyType | 'other'
  partyId?: string
  partyName: string
  grossAmount: number
  taxAmount: number
  netAmount: number
  mode: 'cash' | 'bank' | 'upi' | 'card'
  /** PAN of the party, for the certificate / return. */
  pan?: string
  certificateNo?: string
  challanNo?: string
  note?: string
  /** The document (a bill, a purchase) this relates to, if any — for drill-down only. */
  sourceColl?: string
  sourceId?: string
  branchId?: string
  createdBy: string
  createdAt: number
}

// ───────────────────────────── budgets ─────────────────────────────

/** A budget for one account (by its chart key or code) over a period, to compare against what the ledger actually shows. */
export interface Budget {
  id: string
  label: string
  accountKey: string
  periodStart: number
  periodEnd: number
  amount: number
  costCentreId?: string
  branchId?: string
  note?: string
  createdBy: string
  createdAt: number
}

// ───────────────────────────── cost centres ─────────────────────────────

export interface CostCentre {
  id: string
  code: string
  name: string
  active: boolean
  createdAt: number
}

/** Tags a document (any collection's record) with a cost centre, without that document's own module knowing about it. */
export interface CostCentreTag {
  id: string
  costCentreId: string
  sourceColl: string
  sourceId: string
  createdAt: number
}

// ───────────────────────────── multi-currency ─────────────────────────────

/** The foreign-currency face of a document: its own amount and rate, converted to the book currency (₹). No separate ledger. */
export interface FxTag {
  id: string
  sourceColl: string
  sourceId: string
  currency: string
  rate: number
  foreignAmount: number
  convertedAmount: number
  date: number
  note?: string
  createdAt: number
}

// ───────────────────────────── loans / EMI / PDC ─────────────────────────────

export interface Loan {
  id: string
  name: string
  lender: string
  principal: number
  startDate: number
  tenureMonths: number
  interestRatePct: number
  emiAmount: number
  /** Day of month the EMI is due. */
  emiDay: number
  accountKey: string
  status: 'active' | 'closed'
  note?: string
  branchId?: string
  createdBy: string
  createdAt: number
}

/** One instalment paid. Posts: Dr the loan account (principal) + interest expense, Cr cash/bank. */
export interface LoanRepayment {
  id: string
  loanId: string
  date: number
  amount: number
  principalPart: number
  interestPart: number
  mode: 'cash' | 'bank' | 'upi' | 'card'
  ref?: string
  note?: string
  branchId?: string
  createdBy: string
  createdAt: number
}

export type PdcKind = 'issued' | 'received'
export type PdcStatus = 'pending' | 'cleared' | 'bounced' | 'cancelled'

/**
 * A post-dated cheque register. Tracking only: when a cheque clears or bounces, the actual money movement is recorded
 * the usual way (a voucher, in Accounts) — this just remembers the cheque and reminds a person before it falls due.
 */
export interface Pdc {
  id: string
  kind: PdcKind
  partyType: PartyType | 'other'
  partyId?: string
  partyName: string
  chequeNo: string
  bankName?: string
  amount: number
  dueDate: number
  status: PdcStatus
  clearedAt?: number
  note?: string
  branchId?: string
  createdBy: string
  createdAt: number
}

declare module '@/data/state' {
  interface CollMap {
    bankAccounts: BankAccount
    reconciliationMarks: ReconciliationMark
    fixedAssets: FixedAsset
    depreciationRuns: DepreciationRun
    taxSections: TaxSection
    taxDeductions: TaxDeduction
    budgets: Budget
    costCentres: CostCentre
    costCentreTags: CostCentreTag
    fxTags: FxTag
    loans: Loan
    loanRepayments: LoanRepayment
    pdcs: Pdc
  }
}
