import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const latest = z.object({ customerId: z.string(), channel: z.string(), amountDue: z.string(), sentAt: z.string(), sentBy: z.string().nullable() })
export type LatestReminder = z.infer<typeof latest>

export const useLatestReminders = (companyId: string | undefined) => useQuery({
  queryKey: ['reminders', companyId], enabled: Boolean(companyId), refetchOnMount: 'always',
  queryFn: async (): Promise<Map<string, LatestReminder>> => {
    const r = await currentApi().call(raw()['GET']!('/v1/sales/reminders', { params: { query: { companyId: companyId as string } } }) as never, z.object({ items: z.array(latest) }))
    return new Map(r.items.map((i) => [i.customerId, i]))
  },
})
export const useRecordReminder = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ body }: { body: { companyId: string; customerId: string; channel: 'whatsapp' | 'sms' | 'email' | 'call' | 'copied'; amountDue: string; message: string } }) =>
      currentApi().call(raw()['POST']!('/v1/sales/reminders', { body, headers: { 'idempotency-key': crypto.randomUUID() } }) as never, z.object({ id: z.string() })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  })
}
