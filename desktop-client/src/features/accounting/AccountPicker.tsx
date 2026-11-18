import { useMemo, useState } from 'react'
import type { LedgerAccount } from '@/api/schemas'
import { useWorkspace } from '@/features/organization/workspace'
import { cn } from '@/ui/cn'
import { useAccounts } from './queries'

/** Type a code or name; arrow keys and Enter choose. Only accounts that can be posted to are offered unless `groups` is set. */
export function AccountPicker({ label = 'Account', value, onPick, groups, filter, compact, autoFocus }: { label?: string; value: LedgerAccount | null; onPick: (a: LedgerAccount | null) => void; groups?: boolean; filter?: (a: LedgerAccount) => boolean; compact?: boolean; autoFocus?: boolean }) {
  const ws = useWorkspace()
  const accounts = useAccounts(ws.company?.id)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const q = text.trim().toLowerCase() // the chart is cached locally, so filtering needs no delay
  const options = useMemo(
    () => (accounts.data ?? []).filter((a) => a.status === 'active' && (groups || (!a.isGroup && a.controlKind === null)) && (!filter || filter(a)) && (!q || `${a.code} ${a.name}`.toLowerCase().includes(q))).slice(0, 8),
    [accounts.data, q, groups, filter],
  )
  const open = !value && text.trim().length > 0
  return (
    <div className="relative flex flex-col gap-1">
      {compact ? null : <label className="text-xs font-medium text-muted">{label}</label>}
      <input
        aria-label={label} autoComplete="off" autoFocus={autoFocus} placeholder="Code or name"
        className={cn('h-9 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30', compact && 'h-8 border-transparent bg-transparent hover:border-line')}
        value={value ? `${value.code} · ${value.name}` : text}
        onChange={(e) => { if (value) onPick(null); setText(e.target.value); setActive(0) }}
        onKeyDown={(e) => {
          if (!open) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && options[active]) { e.preventDefault(); e.stopPropagation(); onPick(options[active] as LedgerAccount); setText('') }
        }}
      />
      {open ? (
        <ul role="listbox" aria-label={`${label} results`} className="absolute left-0 top-full z-30 mt-1 max-h-56 w-[26rem] overflow-auto rounded-md border border-line bg-surface text-sm shadow-lg">
          {options.map((a, n) => <li key={a.id}><button type="button" role="option" aria-selected={n === active} className={cn('flex w-full justify-between px-3 py-1.5 text-left', n === active && 'bg-canvas')} onClick={() => { onPick(a); setText('') }}><span>{a.code} · {a.name}</span><span className="text-muted">{a.type}</span></button></li>)}
          {options.length === 0 ? <li className="px-3 py-2 text-muted">No account matches.</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
