import { useState } from 'react'
import type { Item } from '@/api/schemas'
import { useDebounced } from '@/ui/hooks'
import { TextField } from '@/ui/primitives'
import { useItems } from './queries'

/** Type to find an item by code or name, pick one from the short list. */
export function ItemPicker({ label = 'Item', onPick, error }: { label?: string; onPick: (item: Item) => void; error?: string | undefined }) {
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Item | null>(null)
  const q = useDebounced(text.trim())
  const list = useItems({ ...(q ? { q } : {}), status: 'active' })
  return (
    <div className="flex flex-col gap-1">
      <TextField label={label} value={picked ? `${picked.code} · ${picked.name}` : text} onChange={(e) => { setPicked(null); setText(e.target.value) }} placeholder="Search by code or name" error={error} autoComplete="off" />
      {!picked && q ? (
        <ul role="listbox" aria-label={`${label} results`} className="max-h-48 overflow-auto rounded-md border border-line bg-surface text-sm">
          {list.rows.slice(0, 8).map((i) => (
            <li key={i.id}><button type="button" role="option" aria-selected={false} className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-canvas" onClick={() => { setPicked(i); onPick(i) }}><span>{i.code} · {i.name}</span><span className="text-muted">{i.hsnSacCode ?? ''}</span></button></li>
          ))}
          {!list.isPending && list.rows.length === 0 ? <li className="px-3 py-2 text-muted">No item matches.</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
