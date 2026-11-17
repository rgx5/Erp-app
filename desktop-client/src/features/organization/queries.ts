import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { query } from '@/api/client'
import { company, page, type Company } from '@/api/schemas'
import { currentApi } from '@/auth/session'

export const companiesQuery = () => ({
  queryKey: ['companies'] as const,
  queryFn: async (): Promise<Company[]> => {
    const api = currentApi()
    const out: Company[] = []
    let cursor: string | undefined
    do {
      const res = await api.call(api.raw.GET('/v1/companies', { params: { query: query({ limit: 200, cursor }) } }), page(company))
      out.push(...res.items)
      cursor = res.nextCursor ?? undefined
    } while (cursor)
    return out
  },
})
export const useCompanies = () => useQuery(companiesQuery())

/** The company the person is working in; remembered between launches. */
interface Chosen { companyId: string | null; choose(id: string): void }
export const useChosenCompany = create<Chosen>()((set) => ({
  companyId: (() => { try { return localStorage.getItem('onesync.company') } catch { return null } })(),
  choose(id) { try { localStorage.setItem('onesync.company', id) } catch { /* private mode */ } set({ companyId: id }) },
}))
