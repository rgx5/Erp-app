import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import { account, ageing, calculation, invoice, page, position, receipt, statement, type Account, type Ageing, type Calculation, type Invoice, type InvoiceHeader, type Position, type Statement } from '@/api/schemas'
import { invoiceHeader } from '@/api/schemas'
import { currentApi } from '@/auth/session'
import type { paths } from '@/api/schema'

type Body<P extends keyof paths, M extends 'post' | 'put' | 'patch'> = paths[P] extends Record<M, { requestBody: { content: { 'application/json': infer B } } }> ? B : never
export type InvoiceInput = Body<'/v1/sales/invoices', 'post'>
export type NoteInput = Body<'/v1/sales/credit-notes', 'post'>
export type ReceiptInput = Body<'/v1/receivables/receipts', 'post'>

export interface InvoiceFilter { companyId: string; documentType?: string; status?: string; from?: string; to?: string; customerId?: string }
export const useInvoices = (f: InvoiceFilter) => {
  const q = useInfiniteQuery({
    queryKey: ['invoices', f], initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => { const api = currentApi(); return api.call(api.raw.GET('/v1/sales/invoices', { params: { query: query({ limit: 100, cursor: pageParam, ...f }) } }), page(invoiceHeader)) },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? [] as InvoiceHeader[] }
}

export const useInvoice = (id: string | undefined) =>
  useQuery({ queryKey: ['invoice', id], enabled: Boolean(id), queryFn: (): Promise<Invoice> => { const api = currentApi(); return api.call(api.raw.GET('/v1/sales/invoices/{id}', { params: { path: { id: id as string } } }), invoice) } })

/** Totals for what is on the screen, from the server's own pricing code. `body` null means the form is not complete enough to ask. */
export const useCalculation = (body: InvoiceInput | null) =>
  useQuery({
    queryKey: ['calculate', body], enabled: body !== null, networkMode: 'always', staleTime: 0, gcTime: 30_000, placeholderData: (previous) => previous, retry: false,
    queryFn: (): Promise<Calculation> => { const api = currentApi(); return api.call(api.raw.POST('/v1/sales/invoices/calculate', { body: body as InvoiceInput }), calculation) },
  })

function useWrite<I, O>(keys: string[], fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
const SALES_KEYS = ['invoices', 'invoice', 'receipts', 'position', 'ageing', 'statement', 'dashboard']

export const usePostInvoice = () => useWrite(SALES_KEYS, ({ body, key }: { body: InvoiceInput; key: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/sales/invoices', { body, headers: { 'idempotency-key': key } }), invoice) })
export const useCancelInvoice = (id: string) => useWrite(SALES_KEYS, (body: { cancelDate: string; reason: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/sales/invoices/{id}/cancel', { params: { path: { id } }, body }), invoice) })
export const usePostNote = (kind: 'credit' | 'debit') => useWrite(SALES_KEYS, ({ body, key }: { body: NoteInput; key: string }) => { const api = currentApi(); return api.call(kind === 'credit' ? api.raw.POST('/v1/sales/credit-notes', { body, headers: { 'idempotency-key': key } }) : api.raw.POST('/v1/sales/debit-notes', { body, headers: { 'idempotency-key': key } }), invoice) })

export const useReceipts = (companyId: string | undefined, customerId?: string) =>
  useInfiniteQuery({
    queryKey: ['receipts', companyId, customerId], enabled: Boolean(companyId), initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => { const api = currentApi(); return api.call(api.raw.GET('/v1/receivables/receipts', { params: { query: query({ limit: 100, cursor: pageParam, companyId: companyId as string, customerId }) } }), page(receipt)) },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    select: (d) => d.pages.flatMap((p) => p.items),
  })
export const usePostReceipt = () => useWrite(SALES_KEYS, ({ body, key }: { body: ReceiptInput; key: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/receivables/receipts', { body, headers: { 'idempotency-key': key } }), receipt) })
export const useCancelReceipt = (id: string) => useWrite(SALES_KEYS, (body: { cancelDate: string; reason: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/receivables/receipts/{id}/cancel', { params: { path: { id } }, body }), receipt) })

export const usePosition = (companyId: string | undefined, customerId: string | undefined, asOf: string) =>
  useQuery({ queryKey: ['position', companyId, customerId, asOf], enabled: Boolean(companyId && customerId), queryFn: (): Promise<Position> => { const api = currentApi(); return api.call(api.raw.GET('/v1/receivables/customers/{id}/position', { params: { path: { id: customerId as string }, query: query({ companyId: companyId as string, asOf }) } }), position) } })
export const useAgeing = (companyId: string | undefined, asOf: string) =>
  useQuery({ queryKey: ['ageing', companyId, asOf], enabled: Boolean(companyId), queryFn: (): Promise<Ageing> => { const api = currentApi(); return api.call(api.raw.GET('/v1/receivables/ageing', { params: { query: query({ companyId: companyId as string, asOf }) } }), ageing) } })
export const useStatement = (companyId: string | undefined, customerId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: ['statement', companyId, customerId, from, to], enabled: Boolean(companyId && customerId), queryFn: (): Promise<Statement> => { const api = currentApi(); return api.call(api.raw.GET('/v1/receivables/customers/{id}/statement', { params: { path: { id: customerId as string }, query: query({ companyId: companyId as string, from, to }) } }), statement) } })

/** Ordinary asset accounts (cash and bank) a receipt can be banked into. */
export const useCashAccounts = (companyId: string | undefined) =>
  useQuery({
    queryKey: ['accounts', companyId, 'cash-bank'], enabled: Boolean(companyId), staleTime: 300_000,
    queryFn: async (): Promise<Account[]> => {
      const api = currentApi()
      const out: Account[] = []
      let cursor: string | undefined
      do {
        const p = await api.call(api.raw.GET('/v1/accounts', { params: { query: query({ companyId: companyId as string, limit: 200, cursor }) } }), page(account))
        out.push(...p.items); cursor = p.nextCursor ?? undefined
      } while (cursor)
      return out.filter((a) => a.type === 'asset' && !a.isGroup && a.controlKind === null && a.status === 'active')
    },
  })
void z
