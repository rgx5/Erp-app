import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import {
  giftCard, type GiftCard,
  page, posCatalogue, posDevice, posSaleDetail, posSaleHeader, posSaleResult, posSettings, posShift, posTerminal, syncResult,
  type PosCatalogue, type PosDevice, type PosSaleDetail, type PosSaleResult, type PosSettings, type PosShift, type PosTerminal, type SyncResult,
} from '@/api/schemas'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const get = <T>(path: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => currentApi().call(raw()['GET']!(path, { params }) as never, schema)
const send = <T>(method: 'POST' | 'PUT', path: string, body: unknown, schema: z.ZodType<T>, key?: string): Promise<T> =>
  currentApi().call(raw()[method]!(path, { body: body ?? {}, headers: key ? { 'idempotency-key': key } : {} }) as never, schema)
const P = '/v1/pos'

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['pos', 'stock', 'inventory', 'dashboard', 'journals', 'invoice'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}

export const usePosSettings = (companyId: string | undefined) => useQuery({ queryKey: ['pos', 'settings', companyId], enabled: Boolean(companyId), queryFn: (): Promise<PosSettings> => get(`${P}/settings`, { query: query({ companyId: companyId as string }) }, posSettings) })
export const useSavePosSettings = (companyId: string) => useWrite((b: { walkInCustomerId?: string | null; cashVarianceAccountId?: string | null }) => send('PUT', `${P}/settings?companyId=${companyId}`, b, z.unknown()))
export const useMapPayment = (companyId: string) => useWrite((b: { method: string; accountId: string }) => send('PUT', `${P}/payment-accounts?companyId=${companyId}`, b, z.unknown()))
export const useTerminals = (companyId: string | undefined) => useQuery({ queryKey: ['pos', 'terminals', companyId], enabled: Boolean(companyId), queryFn: async (): Promise<PosTerminal[]> => (await get(`${P}/terminals`, { query: query({ companyId: companyId as string }) }, z.object({ items: z.array(posTerminal) }))).items })
export const useCreateTerminal = () => useWrite(({ body, key }: { body: Record<string, unknown>; key: string }) => send('POST', `${P}/terminals`, body, posTerminal, key))
export const useDevices = (companyId: string | undefined) => useQuery({ queryKey: ['pos', 'devices', companyId], enabled: Boolean(companyId), queryFn: async (): Promise<PosDevice[]> => (await get(`${P}/devices`, { query: query({ companyId: companyId as string }) }, z.object({ items: z.array(posDevice) }))).items })
export const useRegisterDevice = () => useWrite(({ body, key }: { body: { terminalId: string; name: string }; key: string }) => send('POST', `${P}/devices`, body, posDevice, key))
export const useRevokeDevice = () => useWrite((id: string) => send('POST', `${P}/devices/${id}/revoke`, {}, posDevice))

export const useShifts = (companyId: string | undefined, status?: string) => {
  const q = useInfiniteQuery({ queryKey: ['pos', 'shifts', companyId, status], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get(`${P}/shifts`, { query: query({ companyId: companyId as string, limit: 50, cursor: pageParam, ...(status ? { status } : {}) }) }, page(posShift)), getNextPageParam: (l) => l.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as PosShift[]) }
}
export const useShift = (id: string | undefined) => useQuery({ queryKey: ['pos', 'shift', id], enabled: Boolean(id), refetchInterval: 15_000, queryFn: (): Promise<PosShift> => get(`${P}/shifts/{id}`, { path: { id } }, posShift) })
export const useOpenShift = () => useWrite(({ body, key }: { body: { terminalId: string; openingCash: string }; key: string }) => send('POST', `${P}/shifts`, body, posShift, key))
export const useCloseShift = (id: string) => useWrite((b: { countedCash: string }) => send('POST', `${P}/shifts/${id}/close`, b, posShift, crypto.randomUUID()))

export const useApprovers = (on: boolean) => useQuery({ queryKey: ['pos', 'approvers'], enabled: on, queryFn: async (): Promise<{ id: string; displayName: string }[]> => (await get(`${P}/approvers`, {}, z.object({ items: z.array(z.object({ id: z.string(), displayName: z.string() })) }))).items })
export const verifyApproval = (body: { userId: string; pin: string }) => send('POST', `${P}/approvals/verify`, body, z.object({ approvedBy: z.string(), displayName: z.string() }))
export const setMyPin = (pin: string) => send('PUT', `${P}/me/pin`, { pin }, z.unknown())
export const postSale = (body: unknown, key: string): Promise<PosSaleResult> => send('POST', `${P}/sales`, body, posSaleResult, key)
export const postReturn = (body: unknown, key: string): Promise<PosSaleResult> => send('POST', `${P}/returns`, body, posSaleResult, key)
export const useSales = (companyId: string | undefined, shiftId?: string, kind?: string) => useQuery({ queryKey: ['pos', 'sales', companyId, shiftId, kind], enabled: Boolean(companyId), queryFn: async () => (await get(`${P}/sales`, { query: query({ companyId: companyId as string, limit: 100, ...(shiftId ? { shiftId } : {}), ...(kind ? { kind } : {}) }) }, page(posSaleHeader))).items })
export const useSaleDetail = (id: string | undefined) => useQuery({ queryKey: ['pos', 'sale', id], enabled: Boolean(id), queryFn: (): Promise<PosSaleDetail> => get(`${P}/sales/{id}`, { path: { id } }, posSaleDetail) })
/** `updatedSince` asks only for items changed after that moment (the counter's regular refresh); without it, everything. */
export const fetchCatalogue = (deviceId: string, updatedSince?: string): Promise<PosCatalogue> => get(`${P}/sync/catalogue`, { query: query({ deviceId, ...(updatedSince ? { updatedSince } : {}) }) }, posCatalogue)
export const uploadBatch = (body: unknown): Promise<SyncResult> => send('POST', `${P}/sync/batches`, body, syncResult)

export const useIssueGiftCard = () => useWrite(({ body, key }: { body: { shiftId: string; amount: string; method: string; holderName?: string; expiresOn?: string }; key: string }) => send('POST', `${P}/gift-cards`, body, giftCard, key))
export const lookupGiftCard = (companyId: string, code: string): Promise<GiftCard> => get(`${P}/gift-cards/${encodeURIComponent(code.trim())}`, { query: query({ companyId }) }, giftCard)
