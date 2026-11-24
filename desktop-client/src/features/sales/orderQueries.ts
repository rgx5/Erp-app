import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import { invoice, orderHeader, page, quote, quoteHeader, salesOrder, type Invoice, type OrderHeader, type Quote, type QuoteHeader, type SalesOrder } from '@/api/schemas'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const get = <T>(path: string, params: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> => currentApi().call(raw()['GET']!(path, { params }) as never, schema)
const post = <T>(path: string, body: unknown, schema: z.ZodType<T>, key?: string): Promise<T> => currentApi().call(raw()['POST']!(path, { body: body ?? {}, headers: key ? { 'idempotency-key': key } : {} }) as never, schema)

function useWrite<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['sales-docs', 'invoices', 'invoice', 'position', 'ageing', 'dashboard', 'stock', 'inventory'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
function useList<H>(key: unknown[], enabled: boolean, load: (cursor: string | undefined) => Promise<{ items: H[]; nextCursor: string | null }>) {
  const q = useInfiniteQuery({ queryKey: ['sales-docs', ...key], enabled, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => load(pageParam), getNextPageParam: (l) => l.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? ([] as H[]) }
}

export const useQuotes = (companyId: string | undefined, status?: string, customerId?: string) => useList<QuoteHeader>(['quotes', companyId, status, customerId], Boolean(companyId), (cursor) => get('/v1/sales/quotes', { query: query({ companyId: companyId as string, limit: 100, cursor, ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) }) }, page(quoteHeader)))
export const useQuote = (id: string | undefined) => useQuery({ queryKey: ['sales-docs', 'quote', id], enabled: Boolean(id), queryFn: (): Promise<Quote> => get('/v1/sales/quotes/{id}', { path: { id } }, quote) })
export const useCreateQuote = () => useWrite(({ body, key }: { body: unknown; key: string }) => post('/v1/sales/quotes', body, quote, key))
export const useRejectQuote = () => useWrite((id: string) => post(`/v1/sales/quotes/${id}/reject`, {}, quote))
export const useConvertQuote = () => useWrite(({ id, body, key }: { id: string; body: { orderDate: string; reserveStock: boolean; customerReference?: string }; key: string }) => post(`/v1/sales/quotes/${id}/convert`, body, salesOrder, key))

export const useOrders = (companyId: string | undefined, status?: string, customerId?: string) => useList<OrderHeader>(['orders', companyId, status, customerId], Boolean(companyId), (cursor) => get('/v1/sales/orders', { query: query({ companyId: companyId as string, limit: 100, cursor, ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) }) }, page(orderHeader)))
export const useOrder = (id: string | undefined) => useQuery({ queryKey: ['sales-docs', 'order', id], enabled: Boolean(id), queryFn: (): Promise<SalesOrder> => get('/v1/sales/orders/{id}', { path: { id } }, salesOrder) })
export const useCreateOrder = () => useWrite(({ body, key }: { body: unknown; key: string }) => post('/v1/sales/orders', body, salesOrder, key))
export const useInvoiceOrder = () => useWrite(({ id, body, key }: { id: string; body: { invoiceDate: string; lines?: { orderLineId: string; quantity: string }[] }; key: string }): Promise<Invoice> => post(`/v1/sales/orders/${id}/invoice`, body, invoice, key))
export const useOrderAction = () => useWrite(({ id, action }: { id: string; action: 'cancel' | 'close' }) => post(`/v1/sales/orders/${id}/${action}`, {}, salesOrder))

export const useChallans = (companyId: string | undefined, status?: string, customerId?: string) => useList<OrderHeader>(['challans', companyId, status, customerId], Boolean(companyId), (cursor) => get('/v1/sales/delivery-challans', { query: query({ companyId: companyId as string, limit: 100, cursor, ...(status ? { status } : {}), ...(customerId ? { customerId } : {}) }) }, page(orderHeader)))
export const useCreateChallan = () => useWrite(({ body, key }: { body: unknown; key: string }) => post('/v1/sales/delivery-challans', body, salesOrder, key))
