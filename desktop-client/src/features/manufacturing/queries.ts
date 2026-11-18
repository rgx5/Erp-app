import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import {
  bom, bomHeader, explosion, mfgSettings, page, rollup, subcontractHeader, subcontractOrder, subcontractPending, variances, wipReconciliation, woVariance, workCentre, workOrder, workOrderHeader,
  type Bom, type Explosion, type MfgSettings, type Rollup, type SubcontractOrder, type SubcontractPending, type Variances, type WipReconciliation, type WoVariance, type WorkCentre, type WorkOrder,
} from '@/api/schemas'
import { currentApi } from '@/auth/session'
import type { paths } from '@/api/schema'

type Body<P extends keyof paths, M extends 'post' | 'put' | 'patch'> = paths[P] extends Record<M, { requestBody: { content: { 'application/json': infer B } } }> ? B : never
const M = '/v1/manufacturing'
// The generated types have no query or response shapes, so the paths are cast once here and every answer is checked by a schema.
const get = <T>(path: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => {
  const api = currentApi()
  return api.call((api.raw as unknown as { GET: (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }> }).GET(path, { params }) as never, schema)
}
const send = <T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, schema: z.ZodType<T>, key?: string): Promise<T> => {
  const api = currentApi()
  return api.call((api.raw as unknown as Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>)[method]!(path, { body: body ?? {}, headers: key ? { 'idempotency-key': key } : {} }) as never, schema)
}

const KEYS = ['mfg', 'items-by-id', 'stock', 'stock-balances', 'inventory', 'dashboard', 'journals', 'trial-balance']
function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
function useList<H>(key: unknown[], enabled: boolean, load: (cursor: string | undefined) => Promise<{ items: H[]; nextCursor: string | null }>) {
  const q = useInfiniteQuery({ queryKey: ['mfg', ...key], enabled, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => load(pageParam), getNextPageParam: (last) => last.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as H[]) }
}

export const useMfgSettings = (companyId: string | undefined) => useQuery({ queryKey: ['mfg', 'settings', companyId], enabled: Boolean(companyId), queryFn: (): Promise<MfgSettings> => get(`${M}/companies/{companyId}/settings`, { path: { companyId } }, mfgSettings) })
export const useSaveMfgSettings = (companyId: string) => useWrite((b: Omit<MfgSettings, 'companyId' | 'version'>) => send('PUT', `${M}/companies/{companyId}/settings`.replace('{companyId}', companyId), b, mfgSettings))

export const useWorkCentres = (companyId: string | undefined) => useQuery({ queryKey: ['mfg', 'work-centres', companyId], enabled: Boolean(companyId), queryFn: async (): Promise<WorkCentre[]> => (await get(`${M}/work-centres`, { query: query({ companyId: companyId as string, limit: 200 }) }, page(workCentre))).items })
export const useCreateWorkCentre = () => useWrite((b: Body<'/v1/manufacturing/work-centres', 'post'>) => send('POST', `${M}/work-centres`, b, workCentre))
export const useUpdateWorkCentre = () => useWrite(({ id, body }: { id: string; body: Body<'/v1/manufacturing/work-centres/{id}', 'patch'> }) => send('PATCH', `${M}/work-centres/${id}`, body, workCentre))

export const useBoms = (companyId: string | undefined, status?: string) =>
  useList(['boms', companyId, status], Boolean(companyId), (cursor) => get(`${M}/boms`, { query: query({ companyId: companyId as string, limit: 100, cursor, ...(status ? { status } : {}) }) }, page(bomHeader)))
export const useBom = (id: string | undefined) => useQuery({ queryKey: ['mfg', 'bom', id], enabled: Boolean(id), queryFn: (): Promise<Bom> => get(`${M}/boms/{id}`, { path: { id } }, bom) })
export const useCreateBom = () => useWrite(({ body, key }: { body: Body<'/v1/manufacturing/boms', 'post'>; key: string }) => send('POST', `${M}/boms`, body, bom, key))
export const useObsoleteBom = () => useWrite((id: string) => send('POST', `${M}/boms/${id}/obsolete`, {}, bom))
export const useExplosion = (companyId: string | undefined, itemId: string | undefined, quantity: string, date: string) =>
  useQuery({ queryKey: ['mfg', 'explode', companyId, itemId, quantity, date], enabled: Boolean(companyId && itemId && Number(quantity) > 0), retry: false, queryFn: (): Promise<Explosion> => get(`${M}/boms/explode`, { query: query({ companyId: companyId as string, itemId: itemId as string, quantity, date }) }, explosion) })
export const useRollup = (companyId: string | undefined, itemId: string | undefined, quantity: string, date: string) =>
  useQuery({ queryKey: ['mfg', 'rollup', companyId, itemId, quantity, date], enabled: Boolean(companyId && itemId && Number(quantity) > 0), retry: false, queryFn: (): Promise<Rollup> => get(`${M}/costing/rollup`, { query: query({ companyId: companyId as string, itemId: itemId as string, quantity, date }) }, rollup) })

export const useWorkOrders = (companyId: string | undefined, status?: string) =>
  useList(['work-orders', companyId, status], Boolean(companyId), (cursor) => get(`${M}/work-orders`, { query: query({ companyId: companyId as string, limit: 100, cursor, ...(status ? { status } : {}) }) }, page(workOrderHeader)))
export const useWorkOrder = (id: string | undefined) => useQuery({ queryKey: ['mfg', 'work-order', id], enabled: Boolean(id), queryFn: (): Promise<WorkOrder> => get(`${M}/work-orders/{id}`, { path: { id } }, workOrder) })
export const useWoVariance = (id: string | undefined, on: boolean) => useQuery({ queryKey: ['mfg', 'wo-variance', id], enabled: Boolean(id) && on, queryFn: (): Promise<WoVariance> => get(`${M}/work-orders/{id}/variance`, { path: { id } }, woVariance) })
export const useCreateWorkOrder = () => useWrite(({ body, key }: { body: Body<'/v1/manufacturing/work-orders', 'post'>; key: string }) => send('POST', `${M}/work-orders`, body, workOrder, key))
export type WoAction = 'release' | 'cancel' | 'issue-materials' | 'return-materials' | 'report-time' | 'report-output' | 'complete'
export const useWoAction = (id: string) => useWrite(({ action, body }: { action: WoAction; body?: unknown }) => send('POST', `${M}/work-orders/${id}/${action}`, body, workOrder, crypto.randomUUID()))

export const useVariances = (companyId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: ['mfg', 'variances', companyId, from, to], enabled: Boolean(companyId && from && to && to >= from), queryFn: (): Promise<Variances> => get(`${M}/costing/variances`, { query: query({ companyId: companyId as string, from, to }) }, variances) })
export const useWip = (companyId: string | undefined, asOf: string) =>
  useQuery({ queryKey: ['mfg', 'wip', companyId, asOf], enabled: Boolean(companyId && asOf), queryFn: (): Promise<WipReconciliation> => get(`${M}/wip-reconciliation`, { query: query({ companyId: companyId as string, asOf }) }, wipReconciliation) })

export const useSubcontracts = (companyId: string | undefined, status?: string) =>
  useList(['subcontracts', companyId, status], Boolean(companyId), (cursor) => get(`${M}/subcontracting/orders`, { query: query({ companyId: companyId as string, limit: 100, cursor, ...(status ? { status } : {}) }) }, page(subcontractHeader)))
export const useSubcontract = (id: string | undefined) => useQuery({ queryKey: ['mfg', 'subcontract', id], enabled: Boolean(id), queryFn: (): Promise<SubcontractOrder> => get(`${M}/subcontracting/orders/{id}`, { path: { id } }, subcontractOrder) })
export const useSubcontractPending = (companyId: string | undefined, asOf: string) =>
  useQuery({ queryKey: ['mfg', 'sub-pending', companyId, asOf], enabled: Boolean(companyId), queryFn: (): Promise<SubcontractPending> => get(`${M}/subcontracting/pending`, { query: query({ companyId: companyId as string, asOf }) }, subcontractPending) })
export const useCreateSubcontract = () => useWrite(({ body, key }: { body: Body<'/v1/manufacturing/subcontracting/orders', 'post'>; key: string }) => send('POST', `${M}/subcontracting/orders`, body, subcontractOrder, key))
export type SubAction = 'release' | 'cancel' | 'send' | 'return' | 'receive' | 'complete'
export const useSubAction = (id: string) => useWrite(({ action, body }: { action: SubAction; body?: unknown }) => send('POST', `${M}/subcontracting/orders/${id}/${action}`, body, subcontractOrder, crypto.randomUUID()))
