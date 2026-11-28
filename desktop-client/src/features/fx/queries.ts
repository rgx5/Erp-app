import { useQuery } from '@tanstack/react-query'
import { send } from '@/api/send'

/** The currencies a business has set up (INR first). One entry means only rupees, and the currency choice is not shown. */
export const useCurrencies = (enabled = true) =>
  useQuery({ queryKey: ['currencies'], enabled, staleTime: 60_000, queryFn: async () => {
    const codes = (await send<{ items: Array<{ code: string; status: string }> }>('GET', '/v1/currencies', { query: { limit: 200 } })).items.filter((c) => c.status === 'active').map((c) => c.code)
    return ['INR', ...codes.filter((c) => c !== 'INR')]
  } })
