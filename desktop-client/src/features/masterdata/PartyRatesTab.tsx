import { useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Item } from '@/api/schemas'
import { formatInr } from '@/domain/format'
import { useDebounced } from '@/ui/hooks'
import { Alert, Button, CheckField, Spinner, TextField } from '@/ui/primitives'
import { usePartyRateActions, usePartyRates } from './partyRates'
import { useItems } from './queries'

/** Prices agreed with one customer or supplier. They are what an item's price starts from the next time a document is made for them. */
export function PartyRatesTab({ partyId, canWrite, buying }: { partyId: string; canWrite: boolean; buying: boolean }) {
  const rates = usePartyRates(partyId); const act = usePartyRateActions(partyId)
  const [text, setText] = useState(''); const q = useDebounced(text.trim(), 200)
  const [item, setItem] = useState<Item | null>(null)
  const [rate, setRate] = useState(''); const [inc, setInc] = useState(false); const [problem, setProblem] = useState<string | null>(null)
  const found = useItems({ ...(q ? { q } : {}), status: 'active' })
  const options = item || !q ? [] : found.rows.filter((i) => (buying ? i.isPurchasable : i.isSellable)).slice(0, 6)
  async function add() {
    if (!item) return
    setProblem(null)
    try { await act.set.mutateAsync({ itemId: item.id, rate: rate.trim(), taxInclusive: inc }); setItem(null); setText(''); setRate(''); setInc(false) }
    catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not save the rate.') }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{buying ? 'The price you have agreed to pay this supplier for an item.' : 'The price you have agreed to charge this customer for an item.'} It is used first when you start a document for them; otherwise the last price they were charged, then your price list.</p>
      {canWrite ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative w-72"><TextField label="Item" placeholder="Type to find an item" autoComplete="off" value={item ? `${item.code} · ${item.name}` : text} onChange={(e) => { setItem(null); setText(e.target.value) }} />
            {options.length > 0 ? <ul role="listbox" aria-label="Item results" className="absolute left-0 top-full z-30 mt-1 w-full overflow-auto rounded-md border border-line bg-surface text-sm shadow-lg">{options.map((i) => <li key={i.id}><button type="button" role="option" aria-selected={false} className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-canvas" onMouseDown={(e) => { e.preventDefault(); setItem(i); setText('') }}><span>{i.code} · {i.name}</span></button></li>)}</ul> : null}
          </div>
          <div className="w-36"><TextField label="Rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
          {!buying ? <CheckField label="Includes GST" checked={inc} onChange={(e) => setInc(e.target.checked)} /> : null}
          <Button disabled={!item || !/^\d{1,14}(\.\d{1,4})?$/.test(rate.trim())} busy={act.set.isPending} onClick={() => void add()}>Save rate</Button>
        </div>) : null}
      {problem ? <Alert>{problem}</Alert> : null}
      {rates.isPending ? <Spinner /> : (rates.data ?? []).length === 0 ? <p className="rounded-md border border-dashed border-line py-8 text-center text-sm text-muted">No special rates for this party yet.</p> : (
        <table className="w-full text-[13px]"><thead><tr><th className="text-left">Item</th><th className="text-right">Rate</th><th className="text-left pl-4">GST</th><th /></tr></thead>
          <tbody>{(rates.data ?? []).map((r) => (
            <tr key={r.id} className="border-b border-line/70"><td className="py-2">{r.itemCode} · {r.itemName}</td><td className="num text-right">{formatInr(r.rate)}</td><td className="pl-4 text-muted">{buying ? '' : r.taxInclusive ? 'Included' : 'Extra'}</td>
              <td className="text-right">{canWrite ? <Button variant="ghost" onClick={() => act.remove.mutate(r.id)}>Remove</Button> : null}</td></tr>))}</tbody></table>)}
    </div>
  )
}
