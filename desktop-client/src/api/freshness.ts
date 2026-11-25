import type { QueryClient } from '@tanstack/react-query'

const MIN = 60_000
/**
 * How long each kind of data is trusted before asking the server again. Things that change a few times a year (units, tax codes, categories,
 * roles, price lists) are kept for ten minutes; big reports are never refetched just because the window got focus (there is a Refresh for that).
 * Everything else keeps the default, which the change notes lengthen while they are connected.
 */
export const REFERENCE_KEYS = ['units', 'tax-codes', 'tax-rates', 'categories', 'payment-terms', 'roles', 'price-lists', 'gst-registrations', 'business-locations', 'warehouses', 'companies'] as const
export const HEAVY_KEYS = ['gst', 'reports', 'report-centre', 'accounting-statements', 'sales-analysis', 'valuation', 'trial-balance', 'profit-loss', 'payables-ageing', 'payables-position', 'payables-statement', 'statement', 'lead-report', 'inventory-reconciliation'] as const

export function applyFreshness(queryClient: QueryClient): void {
  for (const k of REFERENCE_KEYS) queryClient.setQueryDefaults([k], { staleTime: 10 * MIN })
  for (const k of HEAVY_KEYS) queryClient.setQueryDefaults([k], { refetchOnWindowFocus: false, staleTime: 2 * MIN })
}
