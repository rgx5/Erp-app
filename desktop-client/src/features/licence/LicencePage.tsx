import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { send } from '@/api/send'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { Alert, Button, CheckField, FormActions, Spinner, TextField } from '@/ui/primitives'

const MODULES: Array<[string, string]> = [['sales', 'Sales'], ['purchasing', 'Purchasing'], ['inventory', 'Inventory'], ['pos', 'Point of sale'], ['accounting', 'Accounting'], ['gst', 'GST'], ['banking', 'Banking'], ['approvals', 'Approvals'], ['manufacturing', 'Manufacturing'], ['payroll', 'Payroll'], ['extras', 'Extras'], ['leads', 'Leads']]
const LIMITS: Array<[string, string]> = [['users', 'Users'], ['companies', 'Companies'], ['locations', 'Locations'], ['terminals', 'Terminals'], ['sites', 'Sites']]
interface Ent { plan: string | null; modules: string[]; limits: Record<string, number>; readOnly: boolean; expiresAt: string | null; graceDays: number }

/** What this business has licensed. Everyone who can see the organisation can read it; only our own Super admin can change it. */
export function LicencePage() {
  const qc = useQueryClient()
  const editable = can(useSession((s) => s.me?.permissions ?? []), 'platform:licensing')
  const q = useQuery({ queryKey: ['licence'], queryFn: () => send<{ entitlements: Ent | null }>('GET', '/v1/admin/licence') })
  const [mods, setMods] = useState<string[]>([]); const [plan, setPlan] = useState(''); const [readOnly, setReadOnly] = useState(false); const [expires, setExpires] = useState(''); const [grace, setGrace] = useState('14'); const [limits, setLimits] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null); const [saved, setSaved] = useState(false)
  useEffect(() => {
    const e = q.data?.entitlements
    setMods(e ? e.modules : MODULES.map(([k]) => k)); setPlan(e?.plan ?? ''); setReadOnly(e?.readOnly ?? false); setExpires(e?.expiresAt ? e.expiresAt.slice(0, 10) : ''); setGrace(String(e?.graceDays ?? 14)); setLimits(Object.fromEntries(Object.entries(e?.limits ?? {}).map(([k, v]) => [k, String(v)])))
  }, [q.data])
  const save = useMutation({
    mutationFn: () => send('PUT', '/v1/admin/licence', { body: { ...(plan.trim() ? { plan: plan.trim() } : { plan: null }), modules: mods, limits: Object.fromEntries(Object.entries(limits).filter(([, v]) => v.trim() !== '').map(([k, v]) => [k, Number(v)])), readOnly, ...(expires ? { expiresAt: `${expires}T23:59:59.000Z` } : { expiresAt: null }), graceDays: Number(grace) || 0 } }),
    onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: ['licence'] }); void qc.invalidateQueries({ queryKey: ['me'] }) },
  })
  if (q.isPending) return <Spinner />
  const toggle = (k: string) => setMods(mods.includes(k) ? mods.filter((m) => m !== k) : [...mods, k])
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div><h1 className="page-title">Licensing</h1><p className="page-sub">{q.data?.entitlements ? 'The features this business has licensed.' : 'No licence record: everything is available.'}{editable ? '' : ' Contact OneSyncERP to change it.'}</p></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{MODULES.map(([k, label]) => <CheckField key={k} label={label} checked={mods.includes(k)} disabled={!editable} onChange={() => toggle(k)} />)}</div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><TextField label="Plan" value={plan} disabled={!editable} onChange={(e) => setPlan(e.target.value)} /><TextField label="Expires on" type="date" value={expires} disabled={!editable} onChange={(e) => setExpires(e.target.value)} /><TextField label="Grace days" inputMode="numeric" value={grace} disabled={!editable} onChange={(e) => setGrace(e.target.value)} /><div className="flex items-end"><CheckField label="Read-only" checked={readOnly} disabled={!editable} onChange={(e) => setReadOnly(e.target.checked)} /></div></div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">{LIMITS.map(([k, label]) => <TextField key={k} label={`${label} (max)`} inputMode="numeric" placeholder="No limit" value={limits[k] ?? ''} disabled={!editable} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} />)}</div>
      {problem ? <Alert>{problem}</Alert> : null}
      {saved ? <Alert tone="info">Saved.</Alert> : null}
      {editable ? <FormActions><Button busy={save.isPending} onClick={() => { setProblem(null); setSaved(false); save.mutate(undefined, { onError: (e) => setProblem(e instanceof ApiError ? e.message : 'That did not work.') }) }}>Save licence</Button></FormActions> : null}
    </div>
  )
}
