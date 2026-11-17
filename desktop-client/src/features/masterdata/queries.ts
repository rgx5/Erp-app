import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import { address, item, page, party, paymentTerm, price, priceList, taxCode, taxRate, unit, type Address, type Item, type Party, type PaymentTerm, type Price, type PriceList, type TaxCode, type TaxRate, type Unit } from '@/api/schemas'
import { currentApi } from '@/auth/session'
import type { paths } from '@/api/schema'

type Body<P extends keyof paths, M extends 'post' | 'put' | 'patch'> = paths[P] extends Record<M, { requestBody: { content: { 'application/json': infer B } } }> ? B : never

/** A list that loads page after page (cursor) as the person asks, with the search/filter terms as part of its identity. */
function useCursorList<T>(key: QueryKey, schema: z.ZodType<T>, fetchPage: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>) {
  const q = useInfiniteQuery({ queryKey: key, initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => fetchPage(pageParam), getNextPageParam: (last) => last.nextCursor ?? undefined })
  void schema
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? [] }
}

export interface ItemFilter { q?: string; itemType?: string; status?: string }
export const useItems = (f: ItemFilter) =>
  useCursorList<Item>(['items', f], item, (cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/items', { params: { query: query({ limit: 100, cursor, ...f }) } }), page(item)) })

export interface PartyFilter { q?: string; role?: string; status?: string }
export const useParties = (f: PartyFilter) =>
  useCursorList<Party>(['parties', f], party, (cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/parties', { params: { query: query({ limit: 100, cursor, ...f }) } }), page(party)) })

/** Small reference lists (units, tax codes, payment terms, price lists): everything, loaded once and cached. */
async function allPages<T>(load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>): Promise<T[]> {
  const out: T[] = []
  let cursor: string | undefined
  do { const p = await load(cursor); out.push(...p.items); cursor = p.nextCursor ?? undefined } while (cursor)
  return out
}
export const useUnits = () => useQuery({ queryKey: ['units'], staleTime: 300_000, queryFn: (): Promise<Unit[]> => allPages((cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/units', { params: { query: query({ limit: 200, cursor }) } }), page(unit)) }) })
export const useTaxCodes = () => useQuery({ queryKey: ['tax-codes'], queryFn: (): Promise<TaxCode[]> => allPages((cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/tax-codes', { params: { query: query({ limit: 200, cursor }) } }), page(taxCode)) }) })
export const usePaymentTerms = () => useQuery({ queryKey: ['payment-terms'], queryFn: (): Promise<PaymentTerm[]> => allPages((cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/payment-terms', { params: { query: query({ limit: 200, cursor }) } }), page(paymentTerm)) }) })
export const usePriceLists = () => useQuery({ queryKey: ['price-lists'], queryFn: (): Promise<PriceList[]> => allPages((cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/price-lists', { params: { query: query({ limit: 200, cursor }) } }), page(priceList)) }) })

export const useTaxRates = (taxCodeId: string | undefined) =>
  useQuery({ queryKey: ['tax-rates', taxCodeId], enabled: Boolean(taxCodeId), queryFn: async (): Promise<TaxRate[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/tax-codes/{id}/rates', { params: { path: { id: taxCodeId as string } } }), z.object({ items: z.array(taxRate) }))).items } })

export const usePartyAddresses = (partyId: string | undefined) =>
  useQuery({ queryKey: ['party-addresses', partyId], enabled: Boolean(partyId), queryFn: async (): Promise<Address[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/parties/{id}/addresses', { params: { path: { id: partyId as string } } }), z.object({ items: z.array(address) }))).items } })

export const usePrices = (priceListId: string | undefined) =>
  useQuery({ queryKey: ['prices', priceListId], enabled: Boolean(priceListId), queryFn: (): Promise<Price[]> => allPages((cursor) => { const api = currentApi(); return api.call(api.raw.GET('/v1/price-lists/{id}/prices', { params: { path: { id: priceListId as string }, query: query({ limit: 200, cursor }) } }), page(price)) }) })

/** A write that refreshes the lists it affects. */
function useWrite<I, O>(keys: string[], fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}

/** The bare requests (also used by import, which supplies its own idempotency key so a re-run never creates a row twice). */
export const createItemRequest = (body: Body<'/v1/items', 'post'>, key?: string): Promise<Item> => { const api = currentApi(); return api.call(api.raw.POST('/v1/items', { body, ...(key ? { headers: { 'idempotency-key': key } } : {}) }), item) }
export const createPartyRequest = (body: Body<'/v1/parties', 'post'>, key?: string): Promise<Party> => { const api = currentApi(); return api.call(api.raw.POST('/v1/parties', { body, ...(key ? { headers: { 'idempotency-key': key } } : {}) }), party) }
export const useCreateItem = () => useWrite(['items'], (body: Body<'/v1/items', 'post'>) => createItemRequest(body))
export const useUpdateItem = () => useWrite(['items'], ({ id, version, body }: { id: string; version: number; body: Body<'/v1/items/{id}', 'patch'> }) => { const api = currentApi(); return api.call(api.raw.PATCH('/v1/items/{id}', { params: { path: { id } }, headers: { 'if-match': String(version) }, body }), item) })
export const useCreateParty = () => useWrite(['parties'], (body: Body<'/v1/parties', 'post'>) => createPartyRequest(body))
export const useUpdateParty = () => useWrite(['parties'], ({ id, version, body }: { id: string; version: number; body: Body<'/v1/parties/{id}', 'patch'> }) => { const api = currentApi(); return api.call(api.raw.PATCH('/v1/parties/{id}', { params: { path: { id } }, headers: { 'if-match': String(version) }, body }), party) })
export const useCreateAddress = (partyId: string) => useWrite(['party-addresses'], (body: Body<'/v1/parties/{id}/addresses', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/parties/{id}/addresses', { params: { path: { id: partyId } }, body }), address) })
export const useCreatePaymentTerm = () => useWrite(['payment-terms'], (body: Body<'/v1/payment-terms', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/payment-terms', { body }), paymentTerm) })
export const useCreateUnit = () => useWrite(['units'], (body: Body<'/v1/units', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/units', { body }), unit) })
export const useCreateTaxCode = () => useWrite(['tax-codes'], (body: Body<'/v1/tax-codes', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/tax-codes', { body }), taxCode) })
export const useAddTaxRate = (taxCodeId: string) => useWrite(['tax-rates'], (body: Body<'/v1/tax-codes/{id}/rates', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/tax-codes/{id}/rates', { params: { path: { id: taxCodeId } }, body }), taxRate) })
export const useCreatePriceList = () => useWrite(['price-lists'], (body: Body<'/v1/price-lists', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/price-lists', { body }), priceList) })
export const useAddPrice = (priceListId: string) => useWrite(['prices'], (body: Body<'/v1/price-lists/{id}/prices', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/price-lists/{id}/prices', { params: { path: { id: priceListId } }, body }), price) })
export const useClosePrice = (priceListId: string) => useWrite(['prices'], ({ priceId, effectiveTo }: { priceId: string; effectiveTo: string }) => { const api = currentApi(); return api.call(api.raw.POST('/v1/price-lists/{id}/prices/{priceId}/close', { params: { path: { id: priceListId, priceId } }, body: { effectiveTo } }), price) })

/** Looks up a handful of items by id (for showing names next to ids in a table). */
export const useItemsById = (ids: string[]) => {
  const key = [...new Set(ids)].sort((a, b) => a.localeCompare(b))
  return useQuery({
    queryKey: ['items-by-id', key], enabled: key.length > 0,
    queryFn: async (): Promise<Map<string, Item>> => {
      const api = currentApi()
      const found = await Promise.all(key.slice(0, 200).map((id) => api.call(api.raw.GET('/v1/items/{id}', { params: { path: { id } } }), item)))
      return new Map(found.map((i) => [i.id, i]))
    },
  })
}

export const useParty = (id: string | undefined) =>
  useQuery({ queryKey: ['party', id], enabled: Boolean(id), queryFn: (): Promise<Party> => { const api = currentApi(); return api.call(api.raw.GET('/v1/parties/{id}', { params: { path: { id: id as string } } }), party) } })

/** Names for a handful of party ids (so a table of documents can show who they are for). */
export const usePartiesById = (ids: string[]) => {
  const key = [...new Set(ids)].sort((a, b) => a.localeCompare(b))
  return useQuery({
    queryKey: ['parties-by-id', key], enabled: key.length > 0, staleTime: 60_000,
    queryFn: async (): Promise<Map<string, Party>> => {
      const api = currentApi()
      const found = await Promise.all(key.slice(0, 200).map((id) => api.call(api.raw.GET('/v1/parties/{id}', { params: { path: { id } } }), party)))
      return new Map(found.map((p) => [p.id, p]))
    },
  })
}
