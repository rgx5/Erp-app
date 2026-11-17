import { useQuery } from '@tanstack/react-query'
import { query } from '@/api/client'
import { dashboard } from '@/api/schemas'
import { currentApi } from '@/auth/session'

export const useDashboard = (companyId: string | null, asOf: string) =>
  useQuery({
    queryKey: ['dashboard', companyId, asOf],
    enabled: companyId !== null,
    queryFn: () => {
      const api = currentApi()
      return api.call(api.raw.GET('/v1/dashboard', { params: { query: query({ companyId: companyId as string, asOf }) } }), dashboard)
    },
  })
