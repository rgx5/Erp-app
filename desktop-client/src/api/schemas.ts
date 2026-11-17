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
