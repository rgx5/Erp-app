import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { currentApi } from '@/auth/session'

type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
const raw = (): Raw => currentApi().raw as unknown as Raw
const call = <T>(method: 'GET' | 'POST', path: string, schema: z.ZodType<T>, o: { query?: Record<string, string>; body?: unknown; key?: string } = {}): Promise<T> =>
  currentApi().call(raw()[method]!(path, { ...(o.query ? { params: { query: o.query } } : {}), ...(method === 'POST' ? { body: o.body ?? {}, headers: o.key ? { 'idempotency-key': o.key } : {} } : {}) }) as never, schema)

export const recurring = z.object({
  id: z.string(), name: z.string(), customerId: z.string(), frequency: z.string(), startDate: z.string(), endDate: z.string().nullable(), nextRunDate: z.string(), lastRunDate: z.string().nullable(),
  runCount: z.number(), status: z.string(), lastError: z.string().nullable(), documentType: z.string(), gstRegistrationId: z.string(),
})
export type Recurring = z.infer<typeof recurring>
const runRow = z.object({ id: z.string(), scheduledDate: z.string(), status: z.string(), invoiceId: z.string().nullable(), error: z.string().nullable(), invoiceNo: z.string().nullable(), total: z.string().nullable() })
export const recurringDetail = recurring.extend({ lines: z.array(z.object({ itemId: z.string(), quantity: z.string(), unitPrice: z.string(), description: z.string().optional() })), runs: z.array(runRow) })
export const runDueResult = z.object({ asOf: z.string(), generated: z.array(z.object({ recurringId: z.string(), name: z.string(), invoiceId: z.string(), invoiceNo: z.string(), date: z.string() })), failed: z.array(z.object({ recurringId: z.string(), name: z.string(), date: z.string(), error: z.string() })) })
export type RunDueResult = z.infer<typeof runDueResult>

export const FREQUENCIES = [{ value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }, { value: 'quarterly', label: 'Every 3 months' }, { value: 'half_yearly', label: 'Every 6 months' }, { value: 'yearly', label: 'Every year' }]

export const useRecurringList = (companyId: string | undefined) => useQuery({ queryKey: ['recurring', 'list', companyId], enabled: Boolean(companyId), refetchOnMount: 'always', queryFn: async () => (await call('GET', '/v1/sales/recurring-invoices', z.object({ items: z.array(recurring) }), { query: { companyId: companyId as string } })).items })
export const useRecurringDetail = (id: string | undefined) => useQuery({ queryKey: ['recurring', 'one', id], enabled: Boolean(id), queryFn: () => call('GET', `/v1/sales/recurring-invoices/${id}`, recurringDetail) })

function useWrite<I, O>(fn: (i: I) => Promise<O>) {
  const qc = useQueryClient()
  return useMutation({ mutationFn: fn, onSuccess: () => Promise.all(['recurring', 'invoices', 'invoice', 'dashboard', 'position', 'stock'].map((k) => qc.invalidateQueries({ queryKey: [k] }))) })
}
export const useCreateRecurring = () => useWrite(({ body, key }: { body: unknown; key: string }) => call('POST', '/v1/sales/recurring-invoices', recurring, { body, key }))
export const useRecurringAction = () => useWrite(({ id, action }: { id: string; action: 'pause' | 'resume' | 'end' }) => call('POST', `/v1/sales/recurring-invoices/${id}/${action}`, recurring))
export const runDueRecurring = (companyId: string): Promise<RunDueResult> => call('POST', '/v1/sales/recurring-invoices/run-due', runDueResult, { body: { companyId } })
