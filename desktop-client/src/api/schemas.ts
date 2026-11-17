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

export const warehouse = z.object({ id: z.string(), businessLocationId: z.string(), code: z.string(), name: z.string(), kind: z.string(), status: z.string() })
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
  tracking: z.string(), isStocked: z.boolean(), isPurchasable: z.boolean(), isSellable: z.boolean(), isManufactured: z.boolean(), costingMethod: z.string().nullable().optional(), status: z.string(), ...stamps,
})
export type Item = z.infer<typeof item>

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
