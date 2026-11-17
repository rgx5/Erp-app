import { useState } from 'react'
import type { Party } from '@/api/schemas'
import { useDebounced } from '@/ui/hooks'
import { TextField } from '@/ui/primitives'
import { useParties } from './queries'

/** Type to find a customer or supplier by name, code or GSTIN, pick one from the short list. */
export function PartyPicker({ label = 'Customer', role, value, onPick, error, autoFocus }: { label?: string; role: 'customer' | 'supplier'; value?: Party | null | undefined; onPick: (party: Party | null) => void; error?: string | undefined; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const q = useDebounced(text.trim())
  const list = useParties({ role, status: 'active', ...(q ? { q } : {}) })
  return (
    <div className="relative flex flex-col gap-1">
      <TextField label={label} value={value ? `${value.code} · ${value.legalName}` : text} onChange={(e) => { if (value) onPick(null); setText(e.target.value) }} placeholder="Search by name, code or GSTIN" error={error} autoComplete="off" {...(autoFocus ? { autoFocus: true } : {})} />
      {!value && q ? (
        <ul role="listbox" aria-label={`${label} results`} className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line bg-surface text-sm shadow-lg">
          {list.rows.slice(0, 8).map((p) => (
            <li key={p.id}><button type="button" role="option" aria-selected={false} className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-canvas" onClick={() => { onPick(p); setText('') }}><span>{p.code} · {p.legalName}</span><span className="text-muted">{p.gstin ?? ''}</span></button></li>
          ))}
          {!list.isPending && list.rows.length === 0 ? <li className="px-3 py-2 text-muted">Nobody matches.</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
