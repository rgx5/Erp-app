import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Fragment, useState } from 'react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatInr } from '@/domain/format'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { ConvertDrawer } from './ConvertDrawer'
import { FieldInputs, humanKey } from './customFields'
import { LostDialog } from './LostDialog'
import { ago, sourceLabel, useLead, useLeadActions, useLeadSettings, type Activity, type CustomField, type LeadDetail } from './queries'

const human = humanKey
const KIND: Record<string, string> = { note: 'Note', call: 'Call', whatsapp: 'WhatsApp', email: 'Email', visit: 'Visit', survey: 'Site survey', task: 'Task', stage: 'Stage', assign: 'Assigned', system: '' }
const waLink = (phone: string | null): string | null => { const d = (phone ?? '').replace(/\D/g, ''); return d.length >= 10 ? `https://wa.me/${d.length === 10 ? '91' + d : d}` : null }
const when = (iso: string): string => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

function EditDrawer({ lead, defs, onClose }: { lead: LeadDetail; defs: CustomField[]; onClose: () => void }) {
  const a = useLeadActions(); const flash = useFlash(); const [problem, setProblem] = useState<string | null>(null)
  const [v, setV] = useState({ name: lead.name, phone: lead.phone ?? '', email: lead.email ?? '', city: lead.city ?? '', pincode: lead.pincode ?? '', interest: lead.interest ?? '', valueEstimate: lead.valueEstimate ?? '' })
  const [f, setF] = useState<Record<string, string>>({ ...lead.fields })
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  return (
    <Drawer title="Edit lead" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <TextField label="Name" value={v.name} onChange={set('name')} />
        <div className="grid grid-cols-2 gap-3"><TextField label="Phone" value={v.phone} onChange={set('phone')} /><TextField label="Email" value={v.email} onChange={set('email')} /></div>
        <div className="grid grid-cols-2 gap-3"><TextField label="City" value={v.city} onChange={set('city')} /><TextField label="PIN code" value={v.pincode} onChange={set('pincode')} /></div>
        <TextField label="Interested in" value={v.interest} onChange={set('interest')} />
        <TextField label="Expected value, ₹" inputMode="decimal" value={v.valueEstimate} onChange={set('valueEstimate')} />
        {defs.length ? <p className="mt-1 text-sm font-semibold">Details</p> : null}
        <FieldInputs defs={defs} values={f} onChange={(k, x) => setF((y) => ({ ...y, [k]: x }))} />
        {problem ? <Alert>{problem}</Alert> : null}
        <Button busy={a.update.isPending} onClick={async () => {
          setProblem(null)
          try {
            const fields = Object.fromEntries(Object.entries(f).filter(([, x]) => x.trim() !== ''))
            await a.update.mutateAsync({ id: lead.id, body: { name: v.name, phone: v.phone || null, email: v.email || null, city: v.city || null, pincode: v.pincode || null, interest: v.interest || null, valueEstimate: v.valueEstimate.trim() === '' ? null : v.valueEstimate.trim(), fields } })
            flash.show('Saved.'); onClose()
          } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') }
        }}>Save</Button>
      </div>
    </Drawer>
  )
}

/** One lead: who they are, where they came from, what has been done, and what to do next. */
export function LeadPage() {
  const { leadId } = useParams({ from: '/app/leads/$leadId' })
  return <Lead key={leadId} id={leadId} />
}

function Lead({ id }: { id: string }) {
  const navigate = useNavigate(); const flash = useFlash()
  const perms = useSession((s) => s.me?.permissions ?? []); const canWrite = can(perms, 'leads:write')
  const q = useLead(id); const settings = useLeadSettings(); const a = useLeadActions()
  const [panel, setPanel] = useState<'edit' | 'convert' | 'lost' | null>(null)
  const [kind, setKind] = useState('note'); const [body, setBody] = useState(''); const [due, setDue] = useState(''); const [problem, setProblem] = useState<string | null>(null)
  if (q.isPending || settings.isPending) return <Spinner />
  if (q.error || !q.data) return <Alert>{q.error?.message ?? 'Not found.'}</Alert>
  const lead = q.data; const stages = settings.data?.stages ?? []
  const stage = stages.find((s) => s.id === lead.stageId)
  const run = async (f: () => Promise<unknown>, okMsg?: string): Promise<void> => { setProblem(null); try { await f(); if (okMsg) flash.show(okMsg) } catch (e) { setProblem(e instanceof Error ? e.message : 'Something went wrong.') } }
  const wa = waLink(lead.phone)

  async function add() {
    if (!body.trim()) return
    await run(async () => { await a.activity.mutateAsync({ id, kind, body: body.trim(), ...(kind === 'task' && due ? { dueAt: new Date(due).toISOString() } : {}) }); setBody(''); setDue('') })
  }
  const timeline = (act: Activity) => (
    <li key={act.id} className="border-b border-line/60 py-2 last:border-0">
      <div className="flex items-start justify-between gap-2 text-xs text-muted"><span>{KIND[act.kind] ? <b className="text-ink">{KIND[act.kind]}</b> : null}{act.by ? ` · ${act.by}` : ''}</span><span title={when(act.createdAt)}>{ago(act.createdAt)}</span></div>
      <p className={`text-sm ${act.kind === 'system' || act.kind === 'stage' || act.kind === 'assign' ? 'text-muted' : ''}`}>{act.body}</p>
      {act.kind === 'task' ? <p className="mt-0.5 text-xs">{act.doneAt ? <span className="text-good">Done {ago(act.doneAt)}</span> : <>Due {when(act.dueAt as string)}{new Date(act.dueAt as string) < new Date() ? <b className="text-bad"> · overdue</b> : null} {canWrite ? <button className="ml-2 underline" onClick={() => void run(() => a.done.mutateAsync({ id, activityId: act.id }))}>Mark done</button> : null}</>}</p> : null}
    </li>
  )

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted"><Link to="/leads" className="underline">Leads</Link> · {lead.leadNo}</p>
          <h1 className="page-title">{lead.name} {lead.status !== 'open' ? <span className={`ml-2 rounded px-2 py-0.5 text-xs font-medium ${lead.status === 'won' ? 'bg-good/15 text-good' : 'bg-bad/15 text-bad'}`}>{lead.status === 'won' ? 'Won' : 'Lost'}</span> : null}{lead.overdue ? <span className="ml-2 rounded bg-bad/15 px-2 py-0.5 text-xs font-medium text-bad">Not contacted in time</span> : null}</h1>
          <p className="text-sm text-muted">{[lead.phone, lead.email, [lead.city, lead.pincode].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lead.phone ? <a className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3.5 text-sm font-medium hover:bg-canvas" href={`tel:${lead.phone}`}>Call</a> : null}
          {wa ? <a className="inline-flex h-9 items-center rounded-md border border-line bg-surface px-3.5 text-sm font-medium hover:bg-canvas" href={wa} target="_blank" rel="noreferrer">WhatsApp</a> : null}
          {lead.partyId ? <Button variant="secondary" onClick={() => void navigate({ to: '/sales/quotes/new', search: { customerId: lead.partyId } as never })}>New quotation</Button> : canWrite ? <Button variant="secondary" onClick={() => setPanel('convert')}>Make customer</Button> : null}
          {lead.partyId ? <Button variant="secondary" onClick={() => void navigate({ to: '/masterdata/parties/$partyId', params: { partyId: lead.partyId as string } })}>Open customer</Button> : null}
          {canWrite ? <Button variant="secondary" onClick={() => setPanel('edit')}>Edit</Button> : null}
        </div>
      </div>
      {problem ? <Alert>{problem}</Alert> : null}
      <div className="grid gap-3 md:grid-cols-4">
        <SelectField label="Stage" disabled={!canWrite} value={lead.stageId} onChange={(e) => { const s = stages.find((x) => x.id === e.target.value); if (!s) return; if (s.kind === 'lost') setPanel('lost'); else void run(() => a.stage.mutateAsync({ id, stageId: s.id }), `Moved to ${s.name}.`) }} options={stages.map((s) => ({ value: s.id, label: s.name }))} />
        <SelectField label="Owner" disabled={!canWrite} value={lead.ownerId ?? ''} onChange={(e) => void run(() => a.assign.mutateAsync({ id, ownerId: e.target.value || null }), 'Owner changed.')} options={[{ value: '', label: 'Unassigned' }, ...(settings.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))]} />
        <div className="rounded-lg border border-line bg-surface px-4 py-2"><p className="text-xs text-muted">Expected value</p><p className="num text-lg font-semibold">{lead.valueEstimate ? formatInr(lead.valueEstimate) : '—'}</p></div>
        <div className="rounded-lg border border-line bg-surface px-4 py-2"><p className="text-xs text-muted">First response</p><p className="text-lg font-semibold">{lead.firstResponseAt ? `${Math.max(0, Math.round((new Date(lead.firstResponseAt).getTime() - new Date(lead.createdAt).getTime()) / 60000))} min` : lead.overdue ? 'Overdue' : 'Waiting'}</p></div>
      </div>
      {lead.status === 'lost' && lead.lostReason ? <Alert tone="info">Lost: {lead.lostReason}</Alert> : null}

      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <h2 className="mb-2 text-sm font-semibold">About this enquiry</h2>
            <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted">Source</dt><dd>{sourceLabel(lead.source)}</dd>
              {lead.campaign ? <><dt className="text-muted">Campaign</dt><dd>{lead.campaign}</dd></> : null}
              {lead.adset ? <><dt className="text-muted">Ad set</dt><dd>{lead.adset}</dd></> : null}
              {lead.ad ? <><dt className="text-muted">Ad</dt><dd>{lead.ad}</dd></> : null}
              {lead.formName ? <><dt className="text-muted">Form</dt><dd>{lead.formName}</dd></> : null}
              {Object.entries(lead.utm).map(([k, v]) => <Fragment key={k}><dt className="text-muted">{human(k)}</dt><dd>{v}</dd></Fragment>)}
              {lead.clickId ? <><dt className="text-muted">Click id</dt><dd className="break-all text-xs">{lead.clickId}</dd></> : null}
              <dt className="text-muted">Interested in</dt><dd>{lead.interest ?? '—'}</dd>
              <dt className="text-muted">Asked</dt><dd>{lead.enquiryCount} time{lead.enquiryCount === 1 ? '' : 's'}</dd>
              <dt className="text-muted">Consent</dt><dd>{lead.consent ? 'Given' : 'Not recorded'}</dd>
              <dt className="text-muted">Created</dt><dd>{when(lead.createdAt)}</dd>
            </dl>
          </Card>
          <Card>
            <h2 className="mb-2 text-sm font-semibold">Details</h2>
            {(() => {
              const defs = settings.data?.customFields ?? []
              const rows: [string, string][] = [...defs.map((d) => [d.label, lead.fields[d.key] ?? ''] as [string, string]), ...Object.keys(lead.fields).filter((k) => !defs.some((d) => d.key === k)).map((k) => [human(k), lead.fields[k] ?? ''] as [string, string])].filter(([, v]) => v)
              return rows.length === 0 ? <p className="text-sm text-muted">Nothing recorded yet. Use Edit to add details{defs.length ? '' : ', or set up the details you want on every lead in Lead settings'}.</p> : <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-sm">{rows.map(([l, v]) => <Fragment key={l}><dt className="text-muted">{l}</dt><dd>{v}</dd></Fragment>)}</dl>
            })()}
          </Card>
        </div>
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Activity</h2>
          {canWrite ? (
            <div className="mb-3 flex flex-col gap-2 border-b border-line pb-3">
              <div className="flex flex-wrap gap-2">
                <div className="w-40"><SelectField label="Log" value={kind} onChange={(e) => setKind(e.target.value)} options={[{ value: 'note', label: 'Note' }, { value: 'call', label: 'Call' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'email', label: 'Email' }, { value: 'visit', label: 'Visit' }, { value: 'survey', label: 'Site survey' }, { value: 'task', label: 'Follow-up task' }]} /></div>
                {kind === 'task' ? <div className="w-56"><TextField label="Due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></div> : null}
              </div>
              <TextField label="What happened, or what to do" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} />
              <Button className="self-start" busy={a.activity.isPending} disabled={!body.trim() || (kind === 'task' && !due)} onClick={() => void add()}>{kind === 'task' ? 'Add task' : 'Add to history'}</Button>
            </div>
          ) : null}
          <ul aria-label="History">{lead.activities.map(timeline)}</ul>
        </Card>
      </div>
      {panel === 'edit' ? <EditDrawer lead={lead} defs={settings.data?.customFields ?? []} onClose={() => setPanel(null)} /> : null}
      {panel === 'convert' ? <ConvertDrawer lead={lead} onClose={() => setPanel(null)} /> : null}
      {panel === 'lost' ? <LostDialog name={lead.name} reasons={settings.data?.lostReasons ?? []} onClose={() => setPanel(null)} onConfirm={async (reason) => { const lost = stages.find((s) => s.kind === 'lost'); if (lost) await a.stage.mutateAsync({ id, stageId: lost.id, lostReason: reason }); flash.show('Marked as lost.') }} /> : null}
      <p className="text-xs text-muted">{stage ? `Stage: ${stage.name}. ` : ''}Updated {ago(lead.updatedAt)}.</p>
    </div>
  )
}
