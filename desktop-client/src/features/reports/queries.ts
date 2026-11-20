import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { currentApi } from '@/auth/session'

const salesRow = z.object({ key: z.string(), label: z.string(), quantity: z.string(), net: z.string(), tax: z.string(), total: z.string(), cost: z.string(), profit: z.string(), marginPercent: z.string().nullable() })
export const salesReport = z.object({ from: z.string(), to: z.string(), groupBy: z.string(), rows: z.array(salesRow), totals: z.object({ net: z.string(), tax: z.string(), total: z.string(), cost: z.string(), profit: z.string() }) })
export type SalesReport = z.infer<typeof salesReport>
export const GROUP_LABELS = { item: 'Item', category: 'Category', brand: 'Brand', day: 'Day', month: 'Month', cashier: 'Cashier', customer: 'Customer' } as const
export type GroupBy = keyof typeof GROUP_LABELS

export const useSalesReport = (p: { companyId: string | undefined; from: string; to: string; groupBy: GroupBy; categoryId?: string }) =>
  useQuery({
    queryKey: ['reports', 'sales', p], enabled: Boolean(p.companyId) && p.from <= p.to,
    queryFn: (): Promise<SalesReport> => {
      const api = currentApi()
      return api.call(api.raw.GET('/v1/reports/sales', { params: { query: { companyId: p.companyId as string, from: p.from, to: p.to, groupBy: p.groupBy, ...(p.categoryId ? { categoryId: p.categoryId } : {}), limit: '1000' } } }), salesReport)
    },
  })

const money = z.string()
export const dayEndReport = z.object({
  date: z.string(),
  sales: z.object({ bills: z.number(), net: money, tax: money, total: money }),
  returns: z.object({ bills: z.number(), net: money, tax: money, total: money }),
  netSales: money,
  byPaymentMode: z.array(z.object({ method: z.string(), amount: money })),
  shifts: z.array(z.object({ id: z.string(), shiftNo: z.string(), terminal: z.string(), cashier: z.string().nullable(), openedAt: z.string(), closedAt: z.string().nullable(), status: z.string(), openingCash: money, expectedCash: money.nullable(), countedCash: money.nullable(), variance: money.nullable() })),
  topItems: z.array(z.object({ label: z.string(), quantity: z.string(), net: money })),
})
export type DayEndReport = z.infer<typeof dayEndReport>

export const useDayEnd = (companyId: string | undefined, date: string, terminalId?: string) =>
  useQuery({
    queryKey: ['reports', 'day-end', companyId, date, terminalId], enabled: Boolean(companyId) && /^\d{4}-\d{2}-\d{2}$/.test(date),
    queryFn: (): Promise<DayEndReport> => {
      const api = currentApi()
      return api.call(api.raw.GET('/v1/reports/day-end', { params: { query: { companyId: companyId as string, date, ...(terminalId ? { terminalId } : {}) } } }), dayEndReport)
    },
  })
