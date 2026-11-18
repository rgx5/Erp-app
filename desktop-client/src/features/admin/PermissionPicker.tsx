import { useMemo } from 'react'
import { Spinner } from '@/ui/primitives'
import { usePermissions } from './queries'

const GROUP: Record<string, string> = {
  organization: 'Company and places', users: 'Users', roles: 'Roles', api_keys: 'API keys', audit: 'Audit log', numbering: 'Document numbering', masterdata: 'Items and parties', tax: 'Tax codes', pricing: 'Price lists',
  accounting: 'Accounting', stock: 'Inventory', sales: 'Sales', receivables: 'Receivables', pos: 'Point of sale', purchasing: 'Purchasing', payables: 'Payables', payroll: 'Payroll', gst: 'GST returns',
  manufacturing: 'Manufacturing', approvals: 'Approvals', bank: 'Bank', dashboard: 'Dashboard',
}
const ACTION: Record<string, string> = { read: 'View', write: 'Change', post: 'Post', manage: 'Manage', cancel: 'Cancel', reverse: 'Reverse', reopen: 'Reopen periods', close_year: 'Close the year', sell: 'Sell at the counter', return: 'Take returns', sync: 'Upload offline sales', approve: 'Approve', decide: 'Decide', produce: 'Produce', process: 'Process', reconcile: 'Reconcile', writeoff: 'Write off' }

/** Permissions grouped by area, as checkboxes. The list comes from the server, so it is always the one the server enforces. */
export function PermissionPicker({ value, onChange, disabled, limit }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean; limit?: string[] | undefined }) {
  const all = usePermissions()
  const groups = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of all.data ?? []) { if (limit && !limit.includes(p) && !limit.includes('*')) continue; const g = p.split(':')[0] as string; m.set(g, [...(m.get(g) ?? []), p]) }
    return [...m]
  }, [all.data, limit])
  if (all.isPending) return <Spinner />
  const set = new Set(value)
  const toggle = (p: string, on: boolean): void => { const next = new Set(set); if (on) next.add(p); else next.delete(p); onChange([...next]) }
  return (
    <div className="grid grid-cols-2 gap-3" role="group" aria-label="Permissions">
      {groups.map(([g, perms]) => (
        <fieldset key={g} className="rounded-md border border-line p-2" disabled={disabled}>
          <legend className="px-1 text-xs font-semibold text-muted">{GROUP[g] ?? g}</legend>
          {perms.map((p) => { const a = p.split(':')[1] as string; return <label key={p} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" aria-label={p} checked={set.has(p)} onChange={(e) => toggle(p, e.target.checked)} />{ACTION[a] ?? a.replaceAll('_', ' ')}</label> })}
        </fieldset>))}
    </div>
  )
}
