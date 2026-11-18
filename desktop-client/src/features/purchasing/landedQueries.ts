import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import { bill, landedCost, landedCostHeader, page, type Bill, type LandedCost, type LandedCostHeader } from '@/api/schemas'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const get = <T>(path: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => currentApi().call(raw()['GET']!(path, { params }) as never, schema)
const post = <T>(path: string, body: unknown, schema: z.ZodType<T>, key?: string): Promise<T> => currentApi().call(raw()['POST']!(path, { body: body ?? {}, headers: key ? { 'idempotency-key': key } : {} }) as never, schema)

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['landed-costs', 'bills', 'bill', 'goods-receipt', 'goods-receipts', 'stock', 'inventory', 'journals', 'dashboard', 'supplier-position', 'payables'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
export const useLandedCosts = (companyId: string | undefined) => {
  const q = useInfiniteQuery({ queryKey: ['landed-costs', companyId], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get('/v1/purchasing/landed-costs', { query: query({ companyId: companyId as string, limit: 100, cursor: pageParam }) }, page(landedCostHeader)), getNextPageParam: (l) => l.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as LandedCostHeader[]) }
}
export const useLandedCost = (id: string | undefined) => useQuery({ queryKey: ['landed-costs', 'one', id], enabled: Boolean(id), queryFn: (): Promise<LandedCost> => get('/v1/purchasing/landed-costs/{id}', { path: { id } }, landedCost) })
export const useCreateLandedCost = () => useWrite(({ body, key }: { body: unknown; key: string }) => post('/v1/purchasing/landed-costs', body, landedCost, key))
export const useCancelLandedCost = (id: string) => useWrite((b: { cancelDate: string; reason: string }) => post(`/v1/purchasing/landed-costs/${id}/cancel`, b, landedCost, crypto.randomUUID()))
export const usePostDebitNote = () => useWrite(({ body, key }: { body: unknown; key: string }): Promise<Bill> => post('/v1/purchasing/debit-notes', body, bill, key))
