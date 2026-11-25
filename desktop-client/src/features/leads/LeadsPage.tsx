import { Link, useNavigate } from '@tanstack/react-router'
import { LayoutGrid, List, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import type { ImportSpec } from '@/features/masterdata/ImportDialog'
import { useDebounced } from '@/ui/hooks'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { LostDialog } from './LostDialog'
import { NewLeadDrawer } from './NewLeadDrawer'
import { ago, send, SOURCES, sourceLabel, useLeadActions, useLeadCounts, useLeads, useLeadSettings, type Lead, type Stage } from './queries'

const waLink = (phone: string | null): string | null => { const d = (phone ?? '').replace(/\D/g, ''); return d.length >= 10 ? `https://wa.me/${d.length === 10 ? '91' + d : d}` : null }
const SOURCE_TONE: Record<string, string> = { meta: 'bg-blue-100 text-blue-900', google: 'bg-amber-100 text-amber-900', website: 'bg-emerald-100 text-emerald-900' }

function Card({ lead, owners, shown, onOpen }: { lead: Lead; owners: Map<string, string>; shown: { key: string; label: string }[]; onOpen: () => void }) {
  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.setData('text/lead', lead.id); e.dataTransfer.effectAllowed = 'move' }} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      className={`cursor-pointer rounded-lg border bg-surface p-3 text-left shadow-sm hover:border-brand ${lead.overdue ? 'border-bad' : 'border-line'}`}>
      <div className="flex items-start justify-between gap-2"><p className="text-sm font-semibold">{lead.name}</p><span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${SOURCE_TONE[lead.source] ?? 'bg-sunken text-muted'}`}>{sourceLabel(lead.source)}</span></div>
      <p className="text-xs text-muted">{[lead.phone, lead.city].filter(Boolean).join(' · ')}</p>
      {lead.interest ? <p className="mt-1 text-xs">{lead.interest}</p> : null}
      {shown.filter((d) => lead.fields[d.key]).map((d) => <p key={d.key} className="mt-0.5 truncate text-xs"><span className="text-muted">{d.label}:</span> {lead.fields[d.key]}</p>)}
      {lead.campaign ? <p className="mt-1 truncate text-[11px] text-muted">{lead.campaign}</p> : null}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <span className={lead.overdue ? 'font-medium text-bad' : ''}>{lead.overdue ? 'Not contacted · ' : ''}{ago(lead.createdAt)}</span>
        <span>{lead.ownerId ? owners.get(lead.ownerId) ?? lead.ownerName ?? '' : 'Unassigned'}</span>
      </div>
    </div>
  )
}

export const leadImportSpec = (reasonless: undefined): ImportSpec<Record<string, unknown>> => ({
  title: 'Import leads',
  template: { filename: 'leads-template.csv', header: ['Name', 'Phone', 'Email', 'City', 'Pincode', 'Source', 'Campaign', 'Interest'], example: ['Asha Rao', '9810000001', 'asha@example.com', 'Pune', '411001', 'website', 'Summer solar', '5 kW rooftop'] },
  invalidate: ['leads', 'lead-counts'], nameKey: 'name', hints: ['lead', 'enquiry', 'enquiries', 'contact', 'prospect'],
  values: [{ key: 'source', label: 'Source', options: SOURCES, resolve: (raw) => { const n = raw.toLowerCase().replace(/[^a-z]/g, ''); const hit = SOURCES.find((s) => s.value === n || s.label.toLowerCase().replace(/[^a-z]/g, '') === n); if (hit) return hit.value; if (/face|insta|^fb$|^meta/.test(n)) return 'meta'; if (/goog|adwords/.test(n)) return 'google'; if (/site|web|form/.test(n)) return 'website'; return null } }],
  describe: (i) => `${String(i['name'])} · ${String(i['phone'] ?? i['email'] ?? '')}`,
  create: (input) => send('POST', '/v1/leads', { body: input }),
  parse: (r) => {
    void reasonless
    if (!r['name']) return { error: 'Name is required' }
    if (!r['phone'] && !r['email']) return { error: 'A phone number or an email is needed to follow up' }
    return { input: { name: r['name'].slice(0, 200), ...(r['phone'] ? { phone: r['phone'].slice(0, 30) } : {}), ...(r['email'] ? { email: r['email'] } : {}), ...(r['city'] ? { city: r['city'] } : {}), ...(r['pincode'] ? { pincode: r['pincode'] } : {}), source: r['source'] || 'import', ...(r['campaign'] ? { campaign: r['campaign'] } : {}), ...(r['interest'] ? { interest: r['interest'] } : {}) } }
  },
})

/** All the leads: a board with a column per stage (drag a card to move it), or a plain list; with the numbers that need attention on top. */
export function LeadsPage() {
  const navigate = useNavigate(); const flash = useFlash()
  const perms = useSession((s) => s.me?.permissions ?? []); const canWrite = can(perms, 'leads:write')
  const [view, setView] = useState<'board' | 'list'>(() => { try { return localStorage.getItem('onesync.leads.view') === 'list' ? 'list' : 'board' } catch { return 'board' } })
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim())
  const [owner, setOwner] = useState(''); const [source, setSource] = useState(''); const [quick, setQuick] = useState<'' | 'overdue' | 'followUp' | 'unassigned'>('')
  const [showClosed, setShowClosed] = useState(false)
  const [adding, setAdding] = useState(false); const [losing, setLosing] = useState<Lead | null>(null)
  const settings = useLeadSettings(); const counts = useLeadCounts(); const a = useLeadActions()
  const filter = { ...(q ? { q } : {}), ...(owner ? { ownerId: owner } : {}), ...(source ? { source } : {}), ...(quick === 'overdue' ? { overdue: true } : {}), ...(quick === 'followUp' ? { followUpDue: true } : {}), ...(quick === 'unassigned' ? { unassigned: true } : {}), ...(view === 'list' ? {} : showClosed ? {} : { status: 'open' }) }
  const list = useLeads(filter, view === 'board' ? 500 : 100)
  const stages = settings.data?.stages ?? []
  const owners = useMemo(() => new Map((settings.data?.users ?? []).map((u) => [u.id, u.name])), [settings.data?.users])
  const open = (id: string): void => void navigate({ to: '/leads/$leadId', params: { leadId: id } })
  const stageName = (id: string): string => stages.find((s) => s.id === id)?.name ?? ''
  const columns: Stage[] = stages.filter((s) => s.kind === 'open' || showClosed)

  async function move(id: string, stage: Stage) {
    const lead = list.rows.find((l) => l.id === id)
    if (!lead || lead.stageId === stage.id) return
    if (stage.kind === 'lost') { setLosing(lead); return }
    try { await a.stage.mutateAsync({ id, stageId: stage.id }); flash.show(`${lead.name} moved to ${stage.name}.`) } catch (e) { flash.show(e instanceof Error ? e.message : 'Could not move it.') }
  }
  const chip = (id: typeof quick, label: string, n: number | undefined, tone: string) => (
    <button key={id} onClick={() => setQuick(quick === id ? '' : id)} className={`rounded-full border px-3 py-1 text-xs ${quick === id ? 'border-brand bg-brand/10 font-medium' : 'border-line'} ${n ? tone : 'text-muted'}`}>{label} <b>{n ?? 0}</b></button>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div><h1 className="page-title">Leads</h1><p className="page-sub">Enquiries from adverts, your website and people, followed through to a sale.</p></div>
        <div className="flex gap-2">
          <div className="flex overflow-hidden rounded-md border border-line">
            <button aria-label="Board view" aria-pressed={view === 'board'} className={`px-2.5 py-1.5 ${view === 'board' ? 'bg-sunken' : ''}`} onClick={() => { setView('board'); try { localStorage.setItem('onesync.leads.view', 'board') } catch { /* not kept */ } }}><LayoutGrid className="size-4" aria-hidden /></button>
            <button aria-label="List view" aria-pressed={view === 'list'} className={`px-2.5 py-1.5 ${view === 'list' ? 'bg-sunken' : ''}`} onClick={() => { setView('list'); try { localStorage.setItem('onesync.leads.view', 'list') } catch { /* not kept */ } }}><List className="size-4" aria-hidden /></button>
          </div>
          {canWrite ? <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New lead</Button> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2" aria-label="Needs attention">
        {chip('overdue', 'Not contacted in time', counts.data?.overdue, 'border-bad text-bad')}
        {chip('followUp', 'Follow-ups due', counts.data?.followUpDue, 'border-warn text-warn')}
        {chip('unassigned', 'Unassigned', counts.data?.unassigned, '')}
        <span className="rounded-full border border-line px-3 py-1 text-xs text-muted">New today <b>{counts.data?.today ?? 0}</b></span>
      </div>
      <Toolbar>
        <div className="w-72"><TextField label="Search" placeholder="Name, phone, email, city or number" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-48"><SelectField label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} options={[{ value: '', label: 'Everyone' }, ...(settings.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))]} /></div>
        <div className="w-48"><SelectField label="Source" value={source} onChange={(e) => setSource(e.target.value)} options={[{ value: '', label: 'All sources' }, ...SOURCES]} /></div>
        {view === 'board' ? <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show won and lost</label> : null}
      </Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending || settings.isPending ? <Spinner /> : view === 'board' ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {columns.map((s) => {
            const rows = list.rows.filter((l) => l.stageId === s.id)
            return (
              <section key={s.id} aria-label={s.name} className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-sunken p-2" onDragOver={(e) => { if (canWrite) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/lead'); if (id && canWrite) void move(id, s) }}>
                <h2 className="flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-muted"><span>{s.name}</span><span>{s.kind === 'open' ? counts.data?.byStage[s.id] ?? rows.length : rows.length}</span></h2>
                {rows.length === 0 ? <p className="px-1 py-4 text-center text-xs text-muted">{canWrite ? 'Drop a lead here' : 'Nothing here'}</p> : rows.map((l) => <Card key={l.id} lead={l} owners={owners} shown={(settings.data?.customFields ?? []).filter((d) => d.showOnCard)} onOpen={() => open(l.id)} />)}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-left text-xs text-muted"><tr><th className="px-3 py-2">Lead</th><th className="px-3 py-2">Contact</th><th className="px-3 py-2">Source</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">Owner</th><th className="px-3 py-2">Created</th><th className="px-3 py-2" /></tr></thead>
            <tbody>
              {list.rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-10 text-center text-muted">No leads match.</td></tr> : list.rows.map((l) => (
                <tr key={l.id} className="cursor-pointer border-t border-line hover:bg-sunken" onClick={() => open(l.id)}>
                  <td className="px-3 py-2"><span className="font-medium">{l.name}</span> <span className="text-xs text-muted">{l.leadNo}</span>{l.overdue ? <span className="ml-2 rounded bg-bad/15 px-1.5 py-0.5 text-[10px] font-medium text-bad">Not contacted</span> : null}</td>
                  <td className="px-3 py-2">{[l.phone, l.city].filter(Boolean).join(' · ')}</td>
                  <td className="px-3 py-2">{sourceLabel(l.source)}{l.campaign ? <span className="block text-xs text-muted">{l.campaign}</span> : null}</td>
                  <td className="px-3 py-2">{stageName(l.stageId)}</td><td className="px-3 py-2">{l.ownerName ?? (l.ownerId ? owners.get(l.ownerId) : '') ?? ''}</td><td className="px-3 py-2 text-muted">{ago(l.createdAt)}</td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>{waLink(l.phone) ? <a className="text-xs underline" href={waLink(l.phone) as string} target="_blank" rel="noreferrer">WhatsApp</a> : null}</td>
                </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {can(perms, 'leads:manage') && !list.isPending && list.rows.length === 0 && !q && !owner && !source && !quick ? <Alert tone="info">No leads yet. <Link to="/leads/sources" className="underline">Connect your website, Facebook or Google Ads</Link> so enquiries arrive by themselves, or add one by hand.</Alert> : null}
      {adding ? <NewLeadDrawer onClose={() => setAdding(false)} /> : null}
      {losing ? <LostDialog name={losing.name} reasons={settings.data?.lostReasons ?? []} onClose={() => setLosing(null)} onConfirm={async (reason) => { const lost = stages.find((s) => s.kind === 'lost'); if (lost) await a.stage.mutateAsync({ id: losing.id, stageId: lost.id, lostReason: reason }) }} /> : null}
    </div>
  )
}
