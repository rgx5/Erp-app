import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { query } from '@/api/client'
import { cmp08, gstr1, gstr3b, itcRegister, returnSettings, type Cmp08, type Gstr1, type Gstr3b, type ItcRegister } from '@/api/schemas'
import { currentApi } from '@/auth/session'

const month = (registrationId: string | undefined, period: string) => ({ enabled: Boolean(registrationId && /^\d{4}-\d{2}$/.test(period)) })

export const useGstr1 = (registrationId: string | undefined, period: string, on: boolean) =>
  useQuery({ queryKey: ['gst', 'gstr1', registrationId, period], enabled: on && month(registrationId, period).enabled, queryFn: (): Promise<Gstr1> => { const api = currentApi(); return api.call(api.raw.GET('/v1/gst/returns/gstr1', { params: { query: query({ registrationId: registrationId as string, period }) } }), gstr1) } })
export const useGstr3b = (registrationId: string | undefined, period: string, on: boolean) =>
  useQuery({ queryKey: ['gst', 'gstr3b', registrationId, period], enabled: on && month(registrationId, period).enabled, queryFn: (): Promise<Gstr3b> => { const api = currentApi(); return api.call(api.raw.GET('/v1/gst/returns/gstr3b', { params: { query: query({ registrationId: registrationId as string, period }) } }), gstr3b) } })
export const useItcRegister = (registrationId: string | undefined, period: string, on: boolean) =>
  useQuery({ queryKey: ['gst', 'itc', registrationId, period], enabled: on && month(registrationId, period).enabled, queryFn: (): Promise<ItcRegister> => { const api = currentApi(); return api.call(api.raw.GET('/v1/gst/returns/itc-register', { params: { query: query({ registrationId: registrationId as string, period }) } }), itcRegister) } })
export const useCmp08 = (registrationId: string | undefined, quarter: string, on: boolean) =>
  useQuery({ queryKey: ['gst', 'cmp08', registrationId, quarter], enabled: on && Boolean(registrationId && /^\d{4}-Q[1-4]$/.test(quarter)), retry: false, queryFn: (): Promise<Cmp08> => { const api = currentApi(); return api.call(api.raw.GET('/v1/gst/returns/cmp08', { params: { query: query({ registrationId: registrationId as string, quarter }) } }), cmp08) } })
export const useReturnSettings = (registrationId: string | undefined) =>
  useQuery({ queryKey: ['gst', 'settings', registrationId], enabled: Boolean(registrationId), queryFn: () => { const api = currentApi(); return api.call(api.raw.GET('/v1/gst/registrations/{id}/return-settings', { params: { path: { id: registrationId as string } } }), returnSettings) } })
export const useSetCompositionRate = (registrationId: string) => {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (compositionRate: string | null) => { const api = currentApi(); return api.call(api.raw.PUT('/v1/gst/registrations/{id}/return-settings', { params: { path: { id: registrationId } }, body: { compositionRate } }), returnSettings) }, onSuccess: () => qc.invalidateQueries({ queryKey: ['gst'] }) })
}

/** One month's GSTR-3B figures (the annual working adds twelve of them). */
export const fetchGstr3b = (registrationId: string, period: string): Promise<Gstr3b> => { const api = currentApi(); return api.call(api.raw.GET('/v1/gst/returns/gstr3b', { params: { query: query({ registrationId, period }) } }), gstr3b) }
