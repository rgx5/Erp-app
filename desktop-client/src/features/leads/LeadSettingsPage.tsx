import { useEffect, useState } from 'react'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { SOURCES, useLeadActions, useLeadSettings, type AssignRule, type Stage } from './queries'

const list = (s: string): string[] => s.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean)
type Draft = { id?: string; name: string; kind: 'open' | 'won' | 'lost' }

function Stages({ stages }: { stages: Stage[] }) {
  const a = useLeadActions(); const flash = useFlash(); const [problem, setProblem] = useState<string | null>(null)
  const [rows, setRows] = useState<Draft[]>(stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })))
  useEffect(() => setRows(stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))), [stages])
  const move = (i: number, d: number): void => setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j] as Draft, n[i] as Draft]; return n })
  return (
    <Card>
      <h2 className="text-sm font-semibold">Pipeline stages</h2>
      <p className="mb-3 text-xs text-muted">The steps a lead goes through. Keep one Won and one Lost stage; rename, reorder or add the open steps to match how you sell.</p>
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={r.id ?? `n${i}`} className="flex items-center gap-2">
            <input aria-label={`Stage ${i + 1} name`} className="h-9 flex-1 rounded-md border border-line bg-surface px-2 text-sm" value={r.name} onChange={(e) => setRows((x) => x.map((y, k) => (k === i ? { ...y, name: e.target.value } : y)))} />
            <span className={`w-16 text-xs ${r.kind === 'won' ? 'text-good' : r.kind === 'lost' ? 'text-bad' : 'text-muted'}`}>{r.kind === 'open' ? 'Open' : r.kind === 'won' ? 'Won' : 'Lost'}</span>
            <Button variant="ghost" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
            <Button variant="ghost" aria-label={`Move ${r.name} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</Button>
            <Button variant="ghost" aria-label={`Remove ${r.name}`} disabled={r.kind !== 'open'} onClick={() => setRows((x) => x.filter((_, k) => k !== i))}>Remove</Button>
          </li>))}
      </ul>
      {problem ? <div className="mt-2"><Alert>{problem}</Alert></div> : null}
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" onClick={() => setRows((r) => { const at = Math.max(0, r.findIndex((x) => x.kind !== 'open')); const n = [...r]; n.splice(at === -1 ? n.length : at, 0, { name: 'New stage', kind: 'open' }); return n })}>Add a stage</Button>
        <Button busy={a.saveStages.isPending} onClick={async () => { setProblem(null); try { await a.saveStages.mutateAsync(rows); flash.show('Stages saved.') } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') } }}>Save stages</Button>
      </div>
    </Card>
  )
}

function Rules({ rules, users, onChange }: { rules: AssignRule[]; users: { id: string; name: string }[]; onChange: (r: AssignRule[]) => void }) {
  const patch = (i: number, p: Partial<AssignRule>): void => onChange(rules.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const match = (i: number, p: NonNullable<AssignRule['match']>): void => patch(i, { match: { ...rules[i]?.match, ...p } })
  return (
    <div className="flex flex-col gap-3">
      {rules.length === 0 ? <p className="text-sm text-muted">No rules: every lead goes to the members above in turn.</p> : null}
      {rules.map((r, i) => (
        <div key={i} className="rounded-lg border border-line p-3">
          <p className="mb-2 text-xs font-medium text-muted">Rule {i + 1}: leads that match all of these go only to the people chosen. The first matching rule wins.</p>
          <div className="grid gap-2 md:grid-cols-2">
            <TextField label="Cities (comma separated)" value={(r.match?.city ?? []).join(', ')} onChange={(e) => match(i, { city: list(e.target.value) })} />
            <TextField label="PIN codes starting with" value={(r.match?.pincodePrefix ?? []).join(', ')} onChange={(e) => match(i, { pincodePrefix: list(e.target.value) })} />
            <SelectField label="Source" value={r.match?.source?.[0] ?? ''} onChange={(e) => match(i, { source: e.target.value ? [e.target.value] : [] })} options={[{ value: '', label: 'Any source' }, ...SOURCES]} />
            <TextField label="Campaign contains" value={(r.match?.campaign ?? []).join(', ')} onChange={(e) => match(i, { campaign: list(e.target.value) })} />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">{users.map((u) => <label key={u.id} className="flex items-center gap-1.5"><input type="checkbox" checked={r.users.includes(u.id)} onChange={(e) => patch(i, { users: e.target.checked ? [...r.users, u.id] : r.users.filter((x) => x !== u.id) })} /> {u.name}</label>)}</div>
          <Button variant="ghost" className="mt-2" onClick={() => onChange(rules.filter((_, k) => k !== i))}>Remove this rule</Button>
        </div>))}
      <Button variant="secondary" className="self-start" onClick={() => onChange([...rules, { match: {}, users: [] }])}>Add a rule</Button>
    </div>
  )
}

/** How new leads are shared out, how fast they must be answered, why they get lost, and the stages of the pipeline. */
export function LeadSettingsPage() {
  const q = useLeadSettings(); const a = useLeadActions(); const flash = useFlash()
  const [mode, setMode] = useState<'manual' | 'round_robin'>('manual'); const [members, setMembers] = useState<string[]>([]); const [rules, setRules] = useState<AssignRule[]>([])
  const [sla, setSla] = useState('30'); const [reasons, setReasons] = useState(''); const [problem, setProblem] = useState<string | null>(null)
  useEffect(() => { if (q.data) { setMode(q.data.assignmentMode); setMembers(q.data.members); setRules(q.data.rules); setSla(String(q.data.slaMinutes)); setReasons(q.data.lostReasons.join('\n')) } }, [q.data])
  if (q.isPending) return <Spinner />
  if (q.error || !q.data) return <Alert>{q.error?.message ?? 'Could not load.'}</Alert>
  const users = q.data.users
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div><h1 className="page-title">Lead settings</h1><p className="text-sm text-muted">How leads are shared out and followed up.</p></div>
      <Card>
        <h2 className="text-sm font-semibold">Who gets new leads</h2>
        <div className="mt-3 flex flex-col gap-3">
          <SelectField label="Assignment" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} options={[{ value: 'manual', label: 'Manually: new leads wait to be picked up' }, { value: 'round_robin', label: 'Automatically, taking turns' }]} />
          {mode === 'round_robin' ? (<>
            <div><p className="mb-1 text-sm text-muted">The team that takes turns</p><div className="flex flex-wrap gap-3 text-sm">{users.map((u) => <label key={u.id} className="flex items-center gap-1.5"><input type="checkbox" checked={members.includes(u.id)} onChange={(e) => setMembers((m) => (e.target.checked ? [...m, u.id] : m.filter((x) => x !== u.id)))} /> {u.name}</label>)}</div></div>
            <div><p className="mb-1 text-sm font-medium">Special rules (optional)</p><Rules rules={rules} users={users} onChange={setRules} /></div>
          </>) : null}
          <div className="w-64"><TextField label="Answer a new lead within (minutes)" inputMode="numeric" value={sla} onChange={(e) => setSla(e.target.value)} hint="After this, the lead shows as not contacted in time." /></div>
          <div><label className="flex flex-col gap-1 text-sm"><span className="text-muted">Reasons a lead can be lost (one per line)</span><textarea className="min-h-28 rounded-md border border-line bg-surface p-2" value={reasons} onChange={(e) => setReasons(e.target.value)} /></label></div>
          {problem ? <Alert>{problem}</Alert> : null}
          <Button className="self-start" busy={a.saveSettings.isPending} onClick={async () => {
            setProblem(null)
            try { await a.saveSettings.mutateAsync({ assignmentMode: mode, members, rules: rules.filter((r) => r.users.length > 0), slaMinutes: Number(sla), lostReasons: list(reasons) }); flash.show('Saved.') } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') }
          }}>Save</Button>
        </div>
      </Card>
      <Stages stages={q.data.stages} />
    </div>
  )
}
