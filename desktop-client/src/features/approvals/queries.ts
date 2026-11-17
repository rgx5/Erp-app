import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import { approvalPolicy, approvalRequest, page, type ApprovalPolicy, type ApprovalRequest } from '@/api/schemas'
import { currentApi } from '@/auth/session'
import type { paths } from '@/api/schema'

type Body<P extends keyof paths, M extends 'post' | 'put' | 'patch'> = paths[P] extends Record<M, { requestBody: { content: { 'application/json': infer B } } }> ? B : never
export type RequestInput = Body<'/v1/approvals/requests', 'post'>

export interface ApprovalFilter { companyId: string; status?: string; mine?: boolean }
export const useApprovalRequests = (f: ApprovalFilter) => {
  const q = useInfiniteQuery({
    queryKey: ['approvals', f], enabled: Boolean(f.companyId), initialPageParam: undefined as string | undefined, refetchInterval: 20_000,
    queryFn: ({ pageParam }) => { const api = currentApi(); return api.call(api.raw.GET('/v1/approvals/requests', { params: { query: query({ limit: 100, cursor: pageParam, companyId: f.companyId, ...(f.status ? { status: f.status } : {}), ...(f.mine ? { mine: 'true' } : {}) }) } }), page(approvalRequest)) },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? [] as ApprovalRequest[] }
}
export const useApprovalRequest = (id: string | undefined) =>
  useQuery({ queryKey: ['approvals', 'one', id], enabled: Boolean(id), queryFn: (): Promise<ApprovalRequest> => { const api = currentApi(); return api.call(api.raw.GET('/v1/approvals/requests/{id}', { params: { path: { id: id as string } } }), approvalRequest) } })

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }) })
}
export const useRequestApproval = () => useWrite(({ body, key }: { body: RequestInput; key: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/approvals/requests', { body, headers: { 'idempotency-key': key } }), approvalRequest) })
export const useApprove = () => useWrite(({ id, comment }: { id: string; comment?: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/approvals/requests/{id}/approve', { params: { path: { id } }, body: comment ? { comment } : {} }), approvalRequest) })
export const useReject = () => useWrite(({ id, comment }: { id: string; comment: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/approvals/requests/{id}/reject', { params: { path: { id } }, body: { comment } }), approvalRequest) })
export const useCancelRequest = () => useWrite(({ id, reason }: { id: string; reason?: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/approvals/requests/{id}/cancel', { params: { path: { id } }, body: reason ? { reason } : {} }), approvalRequest) })

/** Posts what was approved, to the endpoint it was approved for, carrying the approval. The server checks the document is exactly the approved one. */
export function usePostApproved() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (r: ApprovalRequest): Promise<{ label: string }> => {
      const api = currentApi()
      const headers = { 'idempotency-key': `approved-${r.id}`, 'approval-id': r.id }
      const body = r.payload as never
      if (r.documentType === 'purchase_order') { const o = await api.call(api.raw.POST('/v1/purchasing/orders', { body, headers }), z.object({ poNo: z.string() })); return { label: `Purchase order ${o.poNo} created` } }
      if (r.documentType === 'payment') { const p = await api.call(api.raw.POST('/v1/payables/payments', { body, headers }), z.object({ paymentNo: z.string() })); return { label: `Payment ${p.paymentNo} recorded` } }
      const j = await api.call(api.raw.POST('/v1/journal-entries', { body, headers }), z.object({ entryNo: z.string() })); return { label: `Journal ${j.entryNo} posted` }
    },
    onSuccess: () => Promise.all(['approvals', 'purchase-orders', 'supplier-payments', 'payables-position', 'payables-ageing', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  })
}

export const useApprovalPolicies = (companyId: string | undefined) =>
  useQuery({ queryKey: ['approvals', 'policies', companyId], enabled: Boolean(companyId), queryFn: async (): Promise<ApprovalPolicy[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/approval-policies', { params: { query: query({ companyId: companyId as string }) } }), z.object({ items: z.array(approvalPolicy) }))).items } })
export const useCreatePolicy = () => useWrite((body: Body<'/v1/approval-policies', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/approval-policies', { body }), approvalPolicy) })
export const useUpdatePolicy = () => useWrite(({ id, version, body }: { id: string; version: number; body: Body<'/v1/approval-policies/{id}', 'patch'> }) => { const api = currentApi(); return api.call(api.raw.PATCH('/v1/approval-policies/{id}', { params: { path: { id } }, headers: { 'if-match': String(version) }, body }), approvalPolicy) })
