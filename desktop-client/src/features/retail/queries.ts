import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import { coupon, couponCheck, customerWallet, page, retailSettings, type Coupon, type CouponCheck, type CustomerWallet, type RetailSettings } from '@/api/schemas'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const get = <T>(path: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => currentApi().call(raw()['GET']!(path, { params }) as never, schema)
const send = <T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown, schema: z.ZodType<T>, h: Record<string, string> = {}): Promise<T> => currentApi().call(raw()[method]!(path, { body: body ?? {}, headers: h }) as never, schema)
const R = '/v1/retail'

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['retail'] }) })
}

export const useRetailSettings = (companyId: string | undefined) => useQuery({ queryKey: ['retail', 'settings', companyId], enabled: Boolean(companyId), queryFn: (): Promise<RetailSettings> => get(`${R}/settings`, { query: query({ companyId: companyId as string }) }, retailSettings) })
export const useSaveRetailSettings = (companyId: string) => useWrite((b: { loyaltyPointsPerHundred?: string; loyaltyRupeesPerPoint?: string; maxDiscountWithoutApproval?: string | null }) => send('PUT', `${R}/settings?companyId=${companyId}`, b, retailSettings))
export const useCoupons = (companyId: string | undefined) => {
  const q = useInfiniteQuery({ queryKey: ['retail', 'coupons', companyId], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => get(`${R}/coupons`, { query: query({ companyId: companyId as string, limit: 100, cursor: pageParam }) }, page(coupon)), getNextPageParam: (l) => l.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as Coupon[]) }
}
export const useCreateCoupon = () => useWrite(({ body, key }: { body: Record<string, unknown>; key: string }) => send('POST', `${R}/coupons`, body, coupon, { 'idempotency-key': key }))
export const useUpdateCoupon = () => useWrite(({ id, version, body }: { id: string; version: number; body: Record<string, unknown> }) => send('PATCH', `${R}/coupons/${id}`, body, coupon, { 'if-match': String(version) }))
export const useCustomerWallet = (companyId: string | undefined, customerId: string | undefined) => useQuery({ queryKey: ['retail', 'wallet', companyId, customerId], enabled: Boolean(companyId && customerId), queryFn: (): Promise<CustomerWallet> => get(`${R}/customers/{id}/wallet`, { path: { id: customerId }, query: query({ companyId: companyId as string }) }, customerWallet) })
export const validateCoupon = (body: { companyId: string; code: string; billTotal: string; date?: string }): Promise<CouponCheck> => send('POST', `${R}/coupons/validate`, body, couponCheck)
export const useAdjustPoints = () => useWrite((b: { companyId: string; customerId: string; points: string; note: string }) => send('POST', `${R}/loyalty/adjust`, b, z.unknown()))
