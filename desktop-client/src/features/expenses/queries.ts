import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import { expenseCategory, expenseVoucher, page, type ExpenseCategory, type ExpenseVoucher } from '@/api/schemas'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const get = <T>(path: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => currentApi().call(raw()['GET']!(path, { params }) as never, schema)
const send = <T>(method: 'POST' | 'PATCH', path: string, body: unknown, schema: z.ZodType<T>, h: Record<string, string> = {}): Promise<T> => currentApi().call(raw()[method]!(path, { body: body ?? {}, headers: h }) as never, schema)
const R = '/v1/expenses'

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['expenses', 'journals', 'trial-balance', 'dashboard', 'pos'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
export const useExpenseCategories = (companyId: string | undefined) => useQuery({ queryKey: ['expenses', 'categories', companyId], enabled: Boolean(companyId), queryFn: async (): Promise<ExpenseCategory[]> => (await get(`${R}/categories`, { query: query({ companyId: companyId as string }) }, z.object({ items: z.array(expenseCategory) }))).items })
export const useCreateExpenseCategory = () => useWrite(({ body, key }: { body: Record<string, unknown>; key: string }) => send('POST', `${R}/categories`, body, expenseCategory, { 'idempotency-key': key }))
export const useUpdateExpenseCategory = () => useWrite(({ id, version, body }: { id: string; version: number; body: Record<string, unknown> }) => send('PATCH', `${R}/categories/${id}`, body, expenseCategory, { 'if-match': String(version) }))
export const useExpenses = (companyId: string | undefined, f: { categoryId?: string; from?: string; to?: string; status?: string }) => {
  const q = useInfiniteQuery({ queryKey: ['expenses', 'vouchers', companyId, f], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get(`${R}/vouchers`, { query: query({ companyId: companyId as string, limit: 100, cursor: pageParam, ...f }) }, page(expenseVoucher)), getNextPageParam: (l) => l.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as ExpenseVoucher[]) }
}
export const useCreateExpense = () => useWrite(({ body, key }: { body: Record<string, unknown>; key: string }) => send('POST', `${R}/vouchers`, body, expenseVoucher, { 'idempotency-key': key }))
export const useCancelExpense = (id: string) => useWrite((b: { date: string; reason: string }) => send('POST', `${R}/vouchers/${id}/cancel`, b, expenseVoucher, { 'idempotency-key': crypto.randomUUID() }))
