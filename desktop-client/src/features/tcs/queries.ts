import { useQuery } from '@tanstack/react-query'
import { send } from '@/api/send'

export interface TcsSection { id: string; code: string; description: string; rate: string; status: string }
export const useTcsSections = (enabled = true) =>
  useQuery({ queryKey: ['tcs-sections'], enabled, staleTime: 60_000, queryFn: async () => (await send<{ items: TcsSection[] }>('GET', '/v1/tcs/sections')).items })
