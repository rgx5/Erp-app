import { useQuery } from '@tanstack/react-query'
import { send } from '@/features/leads/queries'

export interface TdsSection { code: string; description: string; rate: string; singleLimit: string; annualLimit: string; status: string }
export interface TdsSuggestion { sectionCode: string; base: string; rate: number; amount: string; applies: boolean; pan: string | null; noPan: boolean; reason: string; paidBeforeInYear: string }
export interface TdsDeduction { id: string; companyId: string; supplierId: string; supplier: string; paymentId: string; paymentNo: string; sectionCode: string; rate: string; baseAmount: string; tdsAmount: string; pan: string | null; noPanRate: boolean; deductedOn: string; status: 'deducted' | 'deposited' | 'cancelled'; challanNo: string | null; challanDate: string | null; depositedOn: string | null; dueDate: string }

export const useTdsSections = () => useQuery({ queryKey: ['tds', 'sections'], queryFn: () => send<{ items: TdsSection[] }>('GET', '/v1/tds/sections').then((r) => r.items) })
export const useTdsSuggestion = (p: { supplierId?: string; sectionCode: string; amount: string; date: string; base?: string }) =>
  useQuery({ queryKey: ['tds', 'suggest', p], enabled: Boolean(p.supplierId && p.sectionCode && /^\d+(\.\d{1,2})?$/.test(p.amount) && Number(p.amount) > 0), retry: false, queryFn: () => send<TdsSuggestion>('GET', '/v1/tds/suggest', { query: { supplierId: p.supplierId, sectionCode: p.sectionCode, amount: p.amount, date: p.date, ...(p.base ? { base: p.base } : {}) } }) })
export const useTdsDeductions = (f: { from?: string; to?: string; status?: string }) => useQuery({ queryKey: ['tds', 'deductions', f], queryFn: () => send<{ items: TdsDeduction[] }>('GET', '/v1/tds/deductions', { query: f }).then((r) => r.items) })
