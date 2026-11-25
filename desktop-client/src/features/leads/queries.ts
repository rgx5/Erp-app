import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { currentApi } from '@/auth/session'

export const SOURCES: { value: string; label: string }[] = [
  { value: 'website', label: 'Website' }, { value: 'meta', label: 'Facebook / Instagram' }, { value: 'google', label: 'Google Ads' }, { value: 'webhook', label: 'Other system' }, { value: 'indiamart', label: 'IndiaMART' },
  { value: 'justdial', label: 'JustDial' }, { value: 'referral', label: 'Referral' }, { value: 'walkin', label: 'Walk-in' }, { value: 'phone', label: 'Phone call' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'import', label: 'Imported' }, { value: 'manual', label: 'Added by hand' }, { value: 'other', label: 'Other' },
]
export const sourceLabel = (v: string): string => SOURCES.find((s) => s.value === v)?.label ?? v

export interface Stage { id: string; name: string; position: number; kind: 'open' | 'won' | 'lost'; status: string }
export interface Lead {
  id: string; leadNo: string; name: string; phone: string | null; email: string | null; city: string | null; pincode: string | null; state: string | null; source: string; connectorId: string | null; campaign: string | null; adset: string | null; ad: string | null; formName: string | null
  utm: Record<string, string>; clickId: string | null; stageId: string; status: 'open' | 'won' | 'lost'; lostReason: string | null; ownerId: string | null; ownerName: string | null; assignedAt: string | null; firstResponseAt: string | null; slaDueAt: string | null; nextFollowUpAt: string | null
  interest: string | null; valueEstimate: string | null; fields: Record<string, string>; consent: boolean; enquiryCount: number; partyId: string | null; convertedAt: string | null; duplicateOf: string | null; createdAt: string; updatedAt: string; overdue: boolean
}
export interface Activity { id: string; kind: string; body: string; dueAt: string | null; doneAt: string | null; createdAt: string; by: string | null }
export interface LeadDetail extends Lead { activities: Activity[] }
export interface AssignRule { match?: { city?: string[]; pincodePrefix?: string[]; source?: string[]; campaign?: string[] }; users: string[] }
export interface CustomField { key: string; label: string; type: 'text' | 'number' | 'select' | 'date' | 'yes_no'; options?: string[]; required?: boolean; showOnCard?: boolean }
export interface Territory { users: string[]; cities?: string[]; pincodePrefix?: string[] }
export interface LeadSettings { assignmentMode: 'manual' | 'round_robin'; members: string[]; rules: AssignRule[]; territories: Territory[]; customFields: CustomField[]; slaMinutes: number; lostReasons: string[]; stages: Stage[]; users: { id: string; name: string; email: string }[] }
export interface Counts { byStage: Record<string, number>; overdue: number; followUpDue: number; unassigned: number; today: number }
export interface Connector { id: string; kind: 'website' | 'meta' | 'google' | 'webhook'; name: string; status: string; publicId: string; path: string; config: { allowedDomains: string[]; pageId: string | null; formIds: string[]; verifyToken: string | null; googleKey: string | null; hasPageToken: boolean; hasAppSecret: boolean; defaultCampaign: string | null }; leadCount: number; lastLeadAt: string | null; lastError: string | null; createdAt: string }
export interface Delivery { id: string; outcome: string; detail: string | null; externalId: string | null; createdAt: string }
export interface ReportRow { source: string; campaign: string; leads: number; open: number; won: number; lost: number; avgResponseMinutes: number | null; revenue: number; spend: number; costPerLead: number | null; costPerWon: number | null; winRate: number | null }
export interface Report { from: string; to: string; items: ReportRow[]; totals: { leads: number; won: number; lost: number; open: number; revenue: number; spend: number; costPerLead: number | null }; funnel: { name: string; kind: string; count: number }[]; response: { answered: number; withinSla: number; overdue: number; waiting: number }; lostReasons: { reason: string; count: number }[] }
export interface Spend { id: string; date: string; source: string; campaign: string; amount: string; impressions: number | null; clicks: number | null; note: string | null }

/** A failed answer keeps what the server said (for a duplicate: which lead it is). */
export class LeadError extends ApiError { constructor(status: number, message: string, extra: Record<string, unknown>) { super(status, String(extra['code'] ?? 'request_failed'), message, undefined, [], extra) } }
type Raw = Record<string, (p: string, o: unknown) => Promise<{ data?: unknown; error?: unknown; response: Response }>>
export async function send<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, o: { path?: Record<string, string>; query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {}): Promise<T> {
  const raw = currentApi().raw as unknown as Raw
  const query = o.query ? Object.fromEntries(Object.entries(o.query).filter(([, v]) => v !== undefined && v !== '')) : undefined
  const r = await raw[method]!(path, { params: { ...(o.path ? { path: o.path } : {}), ...(query ? { query } : {}) }, ...(o.body !== undefined ? { body: o.body } : {}) })
  if (!r.response.ok) { const e = (r.error ?? {}) as Record<string, unknown>; const first = Array.isArray(e['errors']) ? ((e['errors'] as { message?: string }[])[0]?.message) : undefined; throw new LeadError(r.response.status, first ?? (e['detail'] as string | undefined) ?? (e['title'] as string | undefined) ?? 'The request failed', e) }
  return r.data as T
}

export interface LeadFilter { status?: string; stageId?: string; ownerId?: string; unassigned?: boolean; source?: string; q?: string; overdue?: boolean; followUpDue?: boolean; from?: string; to?: string }
export const useLeads = (f: LeadFilter, limit = 200) => {
  const q = useInfiniteQuery({ queryKey: ['leads', f, limit], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => send<{ items: Lead[]; nextCursor: string | null }>('GET', '/v1/leads', { query: { ...f, limit, cursor: pageParam } }), getNextPageParam: (l) => l.nextCursor ?? undefined })
  return { ...q, rows: q.data?.pages.flatMap((p) => p.items) ?? [] as Lead[] }
}
export const useLead = (id: string) => useQuery({ queryKey: ['lead', id], queryFn: () => send<LeadDetail>('GET', '/v1/leads/{id}', { path: { id } }) })
export const useLeadCounts = () => useQuery({ queryKey: ['lead-counts'], queryFn: () => send<Counts>('GET', '/v1/leads/counts'), refetchInterval: 60_000 })
export const useLeadSettings = () => useQuery({ queryKey: ['lead-settings'], queryFn: () => send<LeadSettings>('GET', '/v1/leads/settings') })
export const useConnectors = () => useQuery({ queryKey: ['lead-connectors'], queryFn: () => send<{ items: Connector[] }>('GET', '/v1/leads/connectors').then((r) => r.items) })
export const useDeliveries = (id: string | null) => useQuery({ queryKey: ['lead-deliveries', id], enabled: Boolean(id), queryFn: () => send<{ items: Delivery[] }>('GET', '/v1/leads/connectors/{id}/deliveries', { path: { id: id as string } }).then((r) => r.items) })
export const useReport = (from: string, to: string) => useQuery({ queryKey: ['lead-report', from, to], queryFn: () => send<Report>('GET', '/v1/leads/reports/summary', { query: { from, to } }) })
export const useSpend = (from: string, to: string) => useQuery({ queryKey: ['lead-spend', from, to], queryFn: () => send<{ items: Spend[] }>('GET', '/v1/leads/ad-spend', { query: { from, to } }).then((r) => r.items) })

/** Mutations refresh everything leads-related, so the board, the numbers and the lead's own page never disagree. */
export function useLeadActions() {
  const qc = useQueryClient()
  const refresh = (): Promise<unknown> => Promise.all(['leads', 'lead', 'lead-counts', 'lead-settings', 'lead-connectors', 'lead-deliveries', 'lead-report', 'lead-spend', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  const m = <I, O>(fn: (i: I) => Promise<O>) => useMutation({ mutationFn: fn, onSuccess: refresh }) // eslint-disable-line react-hooks/rules-of-hooks
  return {
    create: m((b: Record<string, unknown>) => send<Lead>('POST', '/v1/leads', { body: b })),
    update: m(({ id, body }: { id: string; body: Record<string, unknown> }) => send('PATCH', '/v1/leads/{id}', { path: { id }, body })),
    stage: m(({ id, stageId, lostReason }: { id: string; stageId: string; lostReason?: string }) => send('POST', '/v1/leads/{id}/stage', { path: { id }, body: { stageId, ...(lostReason ? { lostReason } : {}) } })),
    assign: m(({ id, ownerId }: { id: string; ownerId: string | null }) => send('POST', '/v1/leads/{id}/assign', { path: { id }, body: { ownerId } })),
    activity: m(({ id, kind, body, dueAt }: { id: string; kind: string; body: string; dueAt?: string }) => send('POST', '/v1/leads/{id}/activities', { path: { id }, body: { kind, body, ...(dueAt ? { dueAt } : {}) } })),
    done: m(({ id, activityId }: { id: string; activityId: string }) => send('POST', '/v1/leads/{id}/activities/{activityId}/done', { path: { id, activityId } })),
    link: m(({ id, partyId }: { id: string; partyId: string }) => send('POST', '/v1/leads/{id}/link-customer', { path: { id }, body: { partyId } })),
    merge: m(({ id, intoId }: { id: string; intoId: string }) => send('POST', '/v1/leads/{id}/merge', { path: { id }, body: { intoId } })),
    saveSettings: m((b: Omit<LeadSettings, 'stages' | 'users'>) => send('PUT', '/v1/leads/settings', { body: b })),
    saveStages: m((stages: { id?: string; name: string; kind: string }[]) => send('PUT', '/v1/leads/stages', { body: { stages } })),
    createConnector: m((b: Record<string, unknown>) => send<Connector>('POST', '/v1/leads/connectors', { body: b })),
    updateConnector: m(({ id, body }: { id: string; body: Record<string, unknown> }) => send('PATCH', '/v1/leads/connectors/{id}', { path: { id }, body })),
    deleteConnector: m((id: string) => send('DELETE', '/v1/leads/connectors/{id}', { path: { id } })),
    testConnector: m((id: string) => send('POST', '/v1/leads/connectors/{id}/test', { path: { id } })),
    saveSpend: m((rows: Record<string, unknown>[]) => send('POST', '/v1/leads/ad-spend', { body: { rows } })),
    removeSpend: m((id: string) => send('DELETE', '/v1/leads/ad-spend/{id}', { path: { id } })),
  }
}

/** Minutes, hours or days as people say them: "3 min", "2 h", "1 d". */
export function ago(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
