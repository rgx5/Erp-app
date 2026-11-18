import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import {
  countHeader, movement, movementHeader, page, reconciliation, stockBalance, stockCount, stockLedgerRow, transfer, transferHeader, valuation,
  type InventoryReconciliation, type Movement, type StockBalance, type StockCount, type StockLedgerRow, type Transfer, type Valuation,
} from '@/api/schemas'
import { currentApi } from '@/auth/session'
import type { paths } from '@/api/schema'

type Body<P extends keyof paths, M extends 'post' | 'put' | 'patch'> = paths[P] extends Record<M, { requestBody: { content: { 'application/json': infer B } } }> ? B : never
export type MovementInput = Body<'/v1/stock/movements', 'post'>
export type TransferInput = Body<'/v1/stock/transfers', 'post'>
export type CountInput = Body<'/v1/stock/counts', 'post'>

export const useStockBalances = (companyId: string | undefined, warehouseId?: string) =>
  useQuery({
    queryKey: ['stock-balances', companyId, warehouseId], enabled: Boolean(companyId),
    queryFn: async (): Promise<StockBalance[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/stock/balances', { params: { query: query({ companyId: companyId as string, limit: 500, warehouseId }) } }), z.object({ items: z.array(stockBalance), hasMore: z.boolean() }))).items },
  })

export const useStockCard = (companyId: string | undefined, itemId: string | undefined, warehouseId: string | undefined, from: string, to: string) =>
  useQuery({
    queryKey: ['stock-card', companyId, itemId, warehouseId, from, to], enabled: Boolean(companyId && itemId),
    queryFn: async (): Promise<StockLedgerRow[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/stock/card', { params: { query: query({ companyId: companyId as string, itemId: itemId as string, warehouseId, from, to, limit: 200 }) } }), page(stockLedgerRow))).items },
  })

export const useMovements = (companyId: string | undefined, f: { movementType?: string; from?: string; to?: string }) => {
  const q = useInfiniteQuery({
    queryKey: ['movements', companyId, f], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => { const api = currentApi(); return api.call(api.raw.GET('/v1/stock/movements', { params: { query: query({ limit: 100, cursor: pageParam, companyId: companyId as string, ...f }) } }), page(movementHeader)) },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? [] }
}
export const useMovement = (id: string | undefined) => useQuery({ queryKey: ['movement', id], enabled: Boolean(id), queryFn: (): Promise<Movement> => { const api = currentApi(); return api.call(api.raw.GET('/v1/stock/movements/{id}', { params: { path: { id: id as string } } }), movement) } })

export const useValuation = (companyId: string | undefined, asOf: string) => useQuery({ queryKey: ['valuation', companyId, asOf], enabled: Boolean(companyId), queryFn: (): Promise<Valuation> => { const api = currentApi(); return api.call(api.raw.GET('/v1/stock/valuation', { params: { query: query({ companyId: companyId as string, asOf }) } }), valuation) } })
export const useInventoryReconciliation = (companyId: string | undefined, asOf: string) => useQuery({ queryKey: ['inventory-reconciliation', companyId, asOf], enabled: Boolean(companyId), queryFn: (): Promise<InventoryReconciliation> => { const api = currentApi(); return api.call(api.raw.GET('/v1/inventory/reconciliation', { params: { query: query({ companyId: companyId as string, asOf }) } }), reconciliation) } })

export const useTransfers = (companyId: string | undefined, status?: string) => {
  const q = useInfiniteQuery({
    queryKey: ['transfers', companyId, status], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => { const api = currentApi(); return api.call(api.raw.GET('/v1/stock/transfers', { params: { query: query({ limit: 100, cursor: pageParam, companyId: companyId as string, status }) } }), page(transferHeader)) },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? [] }
}
export const useTransfer = (id: string | undefined) => useQuery({ queryKey: ['transfer', id], enabled: Boolean(id), queryFn: (): Promise<Transfer> => { const api = currentApi(); return api.call(api.raw.GET('/v1/stock/transfers/{id}', { params: { path: { id: id as string } } }), transfer) } })

export const useCounts = (companyId: string | undefined) => {
  const q = useInfiniteQuery({
    queryKey: ['counts', companyId], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => { const api = currentApi(); return api.call(api.raw.GET('/v1/stock/counts', { params: { query: query({ limit: 100, cursor: pageParam, companyId: companyId as string }) } }), page(countHeader)) },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? [] }
}
export const useCount = (id: string | undefined) => useQuery({ queryKey: ['count', id], enabled: Boolean(id), queryFn: (): Promise<StockCount> => { const api = currentApi(); return api.call(api.raw.GET('/v1/stock/counts/{id}', { params: { path: { id: id as string } } }), stockCount) } })

const KEYS = ['stock-balances', 'stock-card', 'movements', 'movement', 'valuation', 'inventory-reconciliation', 'transfers', 'transfer', 'counts', 'count', 'dashboard']
function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
const key = (k: string) => ({ 'idempotency-key': k })
export const usePostMovement = () => useWrite(({ body, key: k }: { body: MovementInput; key: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/stock/movements', { body, headers: key(k) }), movement) })
export const usePostTransfer = () => useWrite(({ body, key: k }: { body: TransferInput; key: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/stock/transfers', { body, headers: key(k) }), transfer) })
export const useReceiveTransfer = (id: string) => useWrite((body: Body<'/v1/stock/transfers/{id}/receive', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/stock/transfers/{id}/receive', { params: { path: { id } }, body }), transfer) })
export const useCancelTransfer = (id: string) => useWrite((body: { postingDate: string; reason: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/stock/transfers/{id}/cancel', { params: { path: { id } }, body }), transfer) })
export const useCreateCount = () => useWrite(({ body, key: k }: { body: CountInput; key: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/stock/counts', { body, headers: key(k) }), stockCount) })
export const useRecordCounts = (id: string) => useWrite((body: Body<'/v1/stock/counts/{id}/counted', 'put'>) => { const api = currentApi(); return api.call(api.raw.PUT('/v1/stock/counts/{id}/counted', { params: { path: { id } }, body }), stockCount) })
export const usePostCount = (id: string) => useWrite((body: { postingDate: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/stock/counts/{id}/post', { params: { path: { id } }, body }), stockCount) })
export const useCancelCount = (id: string) => useWrite(() => { const api = currentApi(); return api.call(api.raw.POST('/v1/stock/counts/{id}/cancel', { params: { path: { id } } }), stockCount) })
