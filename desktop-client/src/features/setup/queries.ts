import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { query } from '@/api/client'
import {
  applyDefaultsResult, businessLocation, company, fiscalYear, gstRegistration, page, setupStatus, warehouse,
  type BusinessLocation, type Company, type FiscalYear, type GstRegistration, type Warehouse,
} from '@/api/schemas'
import { currentApi } from '@/auth/session'
import type { paths } from '@/api/schema'

type Body<P extends keyof paths, M extends 'post' | 'put' | 'patch'> = paths[P] extends Record<M, { requestBody: { content: { 'application/json': infer B } } }> ? B : never

export const useGstRegistrations = (companyId: string | undefined) =>
  useQuery({
    queryKey: ['gst-registrations', companyId], enabled: Boolean(companyId),
    queryFn: async (): Promise<GstRegistration[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/companies/{id}/gst-registrations', { params: { path: { id: companyId as string }, query: query({ limit: 200 }) } }), page(gstRegistration))).items },
  })

export const useLocations = (companyId: string | undefined) =>
  useQuery({
    queryKey: ['business-locations', companyId], enabled: Boolean(companyId),
    queryFn: async (): Promise<BusinessLocation[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/business-locations', { params: { query: query({ companyId: companyId as string, limit: 200 }) } }), page(businessLocation))).items },
  })

export const useWarehouses = (companyId: string | undefined, locationIds: string[]) =>
  useQuery({
    queryKey: ['warehouses', companyId, locationIds], enabled: Boolean(companyId) && locationIds.length > 0,
    queryFn: async (): Promise<Warehouse[]> => {
      const api = currentApi()
      const all = await Promise.all(locationIds.map((id) => api.call(api.raw.GET('/v1/warehouses', { params: { query: query({ businessLocationId: id, limit: 200 }) } }), page(warehouse))))
      return all.flatMap((p) => p.items)
    },
  })

export const useFiscalYears = (companyId: string | undefined) =>
  useQuery({
    queryKey: ['fiscal-years', companyId], enabled: Boolean(companyId),
    queryFn: async (): Promise<FiscalYear[]> => { const api = currentApi(); return (await api.call(api.raw.GET('/v1/fiscal-years', { params: { query: query({ companyId: companyId as string }) } }), z.object({ items: z.array(fiscalYear) }))).items },
  })

export const useSetupStatus = (companyId: string | undefined) =>
  useQuery({
    queryKey: ['setup-status', companyId], enabled: Boolean(companyId),
    queryFn: () => { const api = currentApi(); return api.call(api.raw.GET('/v1/companies/{companyId}/setup/status', { params: { path: { companyId: companyId as string } } }), setupStatus) },
  })

/** Every write below refreshes whatever the setup screens show. */
function useSetupMutation<I, O>(fn: (input: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['companies', 'gst-registrations', 'business-locations', 'warehouses', 'fiscal-years', 'setup-status', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}

export const useCreateCompany = () => useSetupMutation((body: Body<'/v1/companies', 'post'>): Promise<Company> => { const api = currentApi(); return api.call(api.raw.POST('/v1/companies', { body }), company) })
export const useCreateRegistration = (companyId: string) => useSetupMutation((body: Body<'/v1/companies/{id}/gst-registrations', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/companies/{id}/gst-registrations', { params: { path: { id: companyId } }, body }), gstRegistration) })
export const useCreateLocation = () => useSetupMutation((body: Body<'/v1/business-locations', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/business-locations', { body }), businessLocation) })
export const useCreateWarehouse = () => useSetupMutation((body: Body<'/v1/warehouses', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/warehouses', { body }), warehouse) })
export const useCreateFiscalYear = () => useSetupMutation((body: Body<'/v1/fiscal-years', 'post'>) => { const api = currentApi(); return api.call(api.raw.POST('/v1/fiscal-years', { body }), z.unknown()) })
export const useApplyDefaults = (companyId: string) => useSetupMutation((gstRegistrationId?: string) => { const api = currentApi(); return api.call(api.raw.POST('/v1/companies/{companyId}/setup/apply-defaults', { params: { path: { companyId } }, body: gstRegistrationId ? { gstRegistrationId } : {} }), applyDefaultsResult) })
