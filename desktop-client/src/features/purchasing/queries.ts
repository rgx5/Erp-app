import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { query } from '@/api/client'
import {
  bill, billHeader, goodsReceipt, goodsReceiptHeader, grniReport, page, payablesAgeing, purchaseOrder, purchaseOrderHeader, supplierPayment, supplierPosition, supplierStatement,
  type Bill, type GoodsReceipt, type GrniLine, type PayablesAgeing, type PurchaseOrder, type SupplierPosition, type SupplierStatement,
} from '@/api/schemas'
import { currentApi } from '@/auth/session'
import type { paths } from '@/api/schema'

type Body<P extends keyof paths, M extends 'post' | 'put' | 'patch'> = paths[P] extends Record<M, { requestBody: { content: { 'application/json': infer B } } }> ? B : never
export type PurchaseOrderInput = Body<'/v1/purchasing/orders', 'post'>
export type ReceiptInput = Body<'/v1/purchasing/receipts', 'post'>
export type BillInput = Body<'/v1/purchasing/bills', 'post'>
export type PaymentInput = Body<'/v1/payables/payments', 'post'>

function useList<H>(key: unknown[], enabled: boolean, load: (cursor: string | undefined) => Promise<{ items: H[]; nextCursor: string | null }>) {
  const q = useInfiniteQuery({ queryKey: key, enabled, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => load(pageParam), getNextPageParam: (last) => last.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? [] as H[] }
}

export interface OrderFilter { companyId: string; status?: string; supplierId?: string }
export const usePurchaseOrders = (f: OrderFilter) => useList(['purchase-orders', f], Boolean(f.companyId), (cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/purchasing/orders', { params: { query: query({ limit: 100, cursor, ...f }) } }), page(purchaseOrderHeader)) })
export const usePurchaseOrder = (id: string | undefined) => useQuery({ queryKey: ['purchase-order', id], enabled: Boolean(id), queryFn: (): Promise<PurchaseOrder> => { const api = currentApi(); return api.call(api.raw.GET('/v1/purchasing/orders/{id}', { params: { path: { id: id as string } } }), purchaseOrder) } })

export const useGoodsReceipts = (companyId: string | undefined, extra: { supplierId?: string; purchaseOrderId?: string } = {}) =>
  useList(['goods-receipts', companyId, extra], Boolean(companyId), (cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/purchasing/receipts', { params: { query: query({ limit: 100, cursor, companyId: companyId as string, ...extra }) } }), page(goodsReceiptHeader)) })
export const useGoodsReceipt = (id: string | undefined) => useQuery({ queryKey: ['goods-receipt', id], enabled: Boolean(id), queryFn: (): Promise<GoodsReceipt> => { const api = currentApi(); return api.call(api.raw.GET('/v1/purchasing/receipts/{id}', { params: { path: { id: id as string } } }), goodsReceipt) } })

/** Received goods not yet billed, for one supplier: what a bill can be raised against. */
export const useBillableLines = (companyId: string | undefined, supplierId: string | undefined, asOf: string) =>
  useQuery({
    queryKey: ['grni', companyId, supplierId, asOf], enabled: Boolean(companyId && supplierId),
    queryFn: async (): Promise<GrniLine[]> => { const api = currentApi(); const r = await api.call(api.raw.GET('/v1/purchasing/grni', { params: { query: query({ companyId: companyId as string, asOf }) } }), grniReport); return r.lines.filter((l) => l.supplierId === supplierId) },
  })

export interface BillFilter { companyId: string; supplierId?: string; documentType?: string; status?: string; from?: string; to?: string }
export const useBills = (f: BillFilter) => useList(['bills', f], Boolean(f.companyId), (cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/purchasing/bills', { params: { query: query({ limit: 100, cursor, ...f }) } }), page(billHeader)) })
export const useBill = (id: string | undefined) => useQuery({ queryKey: ['bill', id], enabled: Boolean(id), queryFn: (): Promise<Bill> => { const api = currentApi(); return api.call(api.raw.GET('/v1/purchasing/bills/{id}', { params: { path: { id: id as string } } }), bill) } })

export const usePayments = (companyId: string | undefined) => useList(['supplier-payments', companyId], Boolean(companyId), (cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/payables/payments', { params: { query: query({ limit: 100, cursor, companyId: companyId as string }) } }), page(supplierPayment)) })

export const useSupplierPosition = (companyId: string | undefined, supplierId: string | undefined, asOf: string) =>
  useQuery({ queryKey: ['payables-position', companyId, supplierId, asOf], enabled: Boolean(companyId && supplierId), queryFn: (): Promise<SupplierPosition> => { const api = currentApi(); return api.call(api.raw.GET('/v1/payables/suppliers/{id}/position', { params: { path: { id: supplierId as string }, query: query({ companyId: companyId as string, asOf }) } }), supplierPosition) } })
export const usePayablesAgeing = (companyId: string | undefined, asOf: string) =>
  useQuery({ queryKey: ['payables-ageing', companyId, asOf], enabled: Boolean(companyId), queryFn: (): Promise<PayablesAgeing> => { const api = currentApi(); return api.call(api.raw.GET('/v1/payables/ageing', { params: { query: query({ companyId: companyId as string, asOf }) } }), payablesAgeing) } })
export const useSupplierStatement = (companyId: string | undefined, supplierId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: ['payables-statement', companyId, supplierId, from, to], enabled: Boolean(companyId && supplierId), queryFn: (): Promise<SupplierStatement> => { const api = currentApi(); return api.call(api.raw.GET('/v1/payables/suppliers/{id}/statement', { params: { path: { id: supplierId as string }, query: query({ companyId: companyId as string, from, to }) } }), supplierStatement) } })

const KEYS = ['purchase-orders', 'purchase-order', 'goods-receipts', 'goods-receipt', 'grni', 'bills', 'bill', 'supplier-payments', 'payables-position', 'payables-ageing', 'payables-statement', 'approvals', 'dashboard']
function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
const hdr = (key: string, approvalId?: string): Record<string, string> => ({ 'idempotency-key': key, ...(approvalId ? { 'approval-id': approvalId } : {}) })

export const usePostOrder = () => useWrite(({ body, key, approvalId }: { body: PurchaseOrderInput; key: string; approvalId?: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/purchasing/orders', { body, headers: hdr(key, approvalId) }), purchaseOrder) })
export const useCancelOrder = (id: string) => useWrite(() => { const api = currentApi(); return api.call(api.raw.POST('/v1/purchasing/orders/{id}/cancel', { params: { path: { id } } }), purchaseOrderHeader) })
export const useCloseOrder = (id: string) => useWrite(() => { const api = currentApi(); return api.call(api.raw.POST('/v1/purchasing/orders/{id}/close', { params: { path: { id } } }), purchaseOrderHeader) })
export const usePostReceipt = () => useWrite(({ body, key }: { body: ReceiptInput; key: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/purchasing/receipts', { body, headers: hdr(key) }), goodsReceipt) })
export const usePreviewBill = () => useMutation({ mutationFn: (body: BillInput): Promise<Bill> => { const api = currentApi(); return api.call(api.raw.POST('/v1/purchasing/bills/preview', { body }), bill) } })
export const usePostBill = () => useWrite(({ body, key }: { body: BillInput; key: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/purchasing/bills', { body, headers: hdr(key) }), bill) })
export const useCancelBill = (id: string) => useWrite((body: { cancelDate: string; reason: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/purchasing/bills/{id}/cancel', { params: { path: { id } }, body }), bill) })
export const usePostPayment = () => useWrite(({ body, key, approvalId }: { body: PaymentInput; key: string; approvalId?: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/payables/payments', { body, headers: hdr(key, approvalId) }), supplierPayment) })
export const useCancelPayment = (id: string) => useWrite((body: { cancelDate: string; reason: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/payables/payments/{id}/cancel', { params: { path: { id } }, body }), supplierPayment) })
