import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { send } from '@/api/send'

export interface PartyRate { id: string; partyId: string; itemId: string; itemCode: string; itemName: string; rate: string; taxInclusive: boolean }
export interface Suggestion { source: 'party' | 'last' | 'list' | 'none'; price: string | null; taxInclusive: boolean }

export const usePartyRates = (partyId: string | undefined) => useQuery({ queryKey: ['party-rates', partyId], enabled: Boolean(partyId), queryFn: async () => (await send<{ items: PartyRate[] }>('GET', '/v1/parties/{id}/item-rates', { path: { id: partyId as string } })).items })
export function usePartyRateActions(partyId: string) {
  const qc = useQueryClient(); const done = (): void => { void qc.invalidateQueries({ queryKey: ['party-rates', partyId] }) }
  return {
    set: useMutation({ mutationFn: (b: { itemId: string; rate: string; taxInclusive: boolean }) => send('PUT', '/v1/parties/{id}/item-rates', { path: { id: partyId }, body: b }), onSuccess: done }),
    remove: useMutation({ mutationFn: (rateId: string) => send('POST', '/v1/parties/{id}/item-rates/{rateId}/remove', { path: { id: partyId, rateId } }), onSuccess: done }),
  }
}
/** The price to start from when this party buys (or sells) this item. */
export const suggestPrice = (partyId: string, itemId: string, kind: 'sales' | 'purchase'): Promise<Suggestion> => send<Suggestion>('GET', '/v1/parties/{id}/suggested-price', { path: { id: partyId }, query: { itemId, kind } })
