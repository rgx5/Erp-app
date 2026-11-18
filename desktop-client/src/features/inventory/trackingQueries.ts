import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import { availability, batch, page, reservation, serial, stockSettings, type Availability, type Batch, type Reservation, type Serial, type StockSettings } from '@/api/schemas'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const get = <T>(path: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => currentApi().call(raw()['GET']!(path, { params }) as never, schema)
const send = <T>(method: 'POST' | 'PUT', path: string, body: unknown, schema: z.ZodType<T>, key?: string): Promise<T> => currentApi().call(raw()[method]!(path, { body: body ?? {}, headers: key ? { 'idempotency-key': key } : {} }) as never, schema)

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['tracking', 'stock', 'inventory', 'stock-balances'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
export const useBatches = (itemId: string | undefined) => useQuery({ queryKey: ['tracking', 'batches', itemId], enabled: Boolean(itemId), queryFn: async (): Promise<Batch[]> => (await get('/v1/items/{id}/batches', { path: { id: itemId }, query: query({ limit: 200 }) }, page(batch))).items })
export const useCreateBatch = (itemId: string) => useWrite((b: { batchNo: string; manufactureDate?: string; expiryDate?: string }) => send('POST', `/v1/items/${itemId}/batches`, b, batch, crypto.randomUUID()))
export const useBatchStatus = () => useWrite(({ id, status }: { id: string; status: 'active' | 'blocked' }) => send('POST', `/v1/batches/${id}/status`, { status }, batch))
export const useSerials = (itemId: string | undefined, status?: string, warehouseId?: string) => {
  const q = useInfiniteQuery({ queryKey: ['tracking', 'serials', itemId, status, warehouseId], enabled: Boolean(itemId), initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get('/v1/stock/serials', { query: query({ itemId: itemId as string, limit: 100, cursor: pageParam, ...(status ? { status } : {}), ...(warehouseId ? { warehouseId } : {}) }) }, page(serial)), getNextPageParam: (l) => l.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as Serial[]) }
}
export const useReservations = (companyId: string | undefined, status?: string) => {
  const q = useInfiniteQuery({ queryKey: ['tracking', 'reservations', companyId, status], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get('/v1/stock/reservations', { query: query({ companyId: companyId as string, limit: 100, cursor: pageParam, ...(status ? { status } : {}) }) }, page(reservation)), getNextPageParam: (l) => l.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as Reservation[]) }
}
export const useCreateReservation = () => useWrite(({ body, key }: { body: Record<string, unknown>; key: string }) => send('POST', '/v1/stock/reservations', body, reservation, key))
export const useReleaseReservation = () => useWrite((id: string) => send('POST', `/v1/stock/reservations/${id}/release`, {}, reservation))
export const useAvailability = (companyId: string | undefined, itemId: string | undefined) => useQuery({ queryKey: ['tracking', 'availability', companyId, itemId], enabled: Boolean(companyId && itemId), queryFn: (): Promise<Availability> => get('/v1/stock/availability', { query: query({ companyId: companyId as string, itemId: itemId as string }) }, availability) })
export const useStockSettings = (companyId: string | undefined) => useQuery({ queryKey: ['tracking', 'settings', companyId], enabled: Boolean(companyId), queryFn: (): Promise<StockSettings> => get('/v1/companies/{companyId}/stock-settings', { path: { companyId } }, stockSettings) })
export const useSaveStockSettings = (companyId: string) => useWrite((b: { adjustmentAccountId?: string | null; openingBalanceAccountId?: string | null }) => send('PUT', `/v1/companies/${companyId}/stock-settings`, b, stockSettings))
