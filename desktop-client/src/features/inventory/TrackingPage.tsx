import { useState } from 'react'
import type { Item, LedgerAccount } from '@/api/schemas'
import { ApiError } from '@/api/errors'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, todayIso } from '@/domain/format'
import { showQty } from '@/domain/quantity'
import { AccountPicker } from '@/features/accounting/AccountPicker'
import { useAccounts } from '@/features/accounting/queries'
import { ItemPicker } from '@/features/masterdata/ItemPicker'
import { useItemsById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { useAvailability, useBatchStatus, useBatches, useCreateBatch, useCreateReservation, useReleaseReservation, useReservations, useSaveStockSettings, useSerials, useSetNegativeStock, useStockSettings } from './trackingQueries'

type Tab = 'batches' | 'serials' | 'reservations' | 'settings'
const msg = (e: unknown, f: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : f)

function ItemChooser({ tracking, onPick, value }: { tracking: 'batch' | 'serial'; onPick: (i: Item) => void; value: Item | null }) {
  return (
    <div className="max-w-md"><ItemPicker label={tracking === 'batch' ? 'Batch-tracked item' : 'Serial-tracked item'} onPick={onPick} />
      {value ? <p className="mt-1 text-xs text-muted">{value.code} · {value.name}{value.tracking !== tracking ? ` is not ${tracking}-tracked` : ''}</p> : null}</div>
  )
}

function Batches() {
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'stock:manage')
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'stock:post')
  const [item, setItem] = useState<Item | null>(null)
  const ok = item?.tracking === 'batch'
  const list = useBatches(ok ? item.id : undefined)
  const create = useCreateBatch(item?.id ?? ''); const status = useBatchStatus()
  const flash = useFlash()
  const [no, setNo] = useState(''); const [mfg, setMfg] = useState(''); const [exp, setExp] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const today = todayIso()
  return (
    <div className="flex flex-col gap-3">
      <ItemChooser tracking="batch" onPick={setItem} value={item} />
      {ok ? (
        <>
          {list.isPending ? <Spinner /> : list.data?.length === 0 ? <Alert tone="info">No batches yet.</Alert> : (
            <table className="w-full text-sm" aria-label="Batches"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Batch</th><th className="py-1">Made</th><th className="py-1">Expires</th><th className="py-1">Status</th><th /></tr></thead>
              <tbody>{list.data?.map((b) => <tr key={b.id} className="border-t border-line/60"><td className="py-1.5">{b.batchNo}</td><td className="py-1.5">{b.manufactureDate ? formatDate(b.manufactureDate) : ''}</td>
                <td className={`py-1.5 ${b.expiryDate && b.expiryDate < today ? 'text-bad' : ''}`}>{b.expiryDate ? `${formatDate(b.expiryDate)}${b.expiryDate < today ? ' (expired)' : ''}` : ''}</td><td className="py-1.5">{b.status === 'active' ? 'Active' : 'Blocked'}</td>
                <td className="py-1.5 text-right">{canManage ? <Button variant="ghost" aria-label={`${b.status === 'active' ? 'Block' : 'Unblock'} ${b.batchNo}`} onClick={() => void status.mutateAsync({ id: b.id, status: b.status === 'active' ? 'blocked' : 'active' })}>{b.status === 'active' ? 'Block' : 'Unblock'}</Button> : null}</td></tr>)}</tbody></table>)}
          {canPost ? (
            <Card title="New batch"><div className="grid grid-cols-3 gap-3"><TextField label="Batch number" value={no} onChange={(e) => setNo(e.target.value)} /><TextField label="Made on (optional)" type="date" value={mfg} onChange={(e) => setMfg(e.target.value)} /><TextField label="Expires on (optional)" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div>
              {problem ? <Alert>{problem}</Alert> : null}
              <Button className="mt-3" disabled={!no.trim()} busy={create.isPending} onClick={async () => { setProblem(null); try { await create.mutateAsync({ batchNo: no.trim(), ...(mfg ? { manufactureDate: mfg } : {}), ...(exp ? { expiryDate: exp } : {}) }); flash.show(`Batch ${no.trim()} created.`); setNo(''); setMfg(''); setExp('') } catch (e) { setProblem(msg(e, 'Could not create the batch.')) } }}>Create batch</Button>
              <p className="mt-2 text-xs text-muted">Batches are usually made when goods come in (an adjustment or opening stock can name a new batch). A blocked batch cannot be issued.</p></Card>) : null}
        </>
      ) : null}
    </div>
  )
}

function Serials() {
  const ws = useWorkspace()
  const [item, setItem] = useState<Item | null>(null)
  const [status, setStatus] = useState('')
  const [find, setFind] = useState('')
  const ok = item?.tracking === 'serial'
  const list = useSerials(ok ? item.id : undefined, status || undefined)
  const rows = list.rows.filter((r) => !find || r.serialNo.toLowerCase().includes(find.toLowerCase()))
  return (
    <div className="flex flex-col gap-3">
      <ItemChooser tracking="serial" onPick={setItem} value={item} />
      {ok ? (
        <>
          <div className="flex gap-3"><div className="w-44"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'in_stock', label: 'In stock' }, { value: 'issued', label: 'Sold or issued' }]} /></div><div className="w-56"><TextField label="Find a serial number" value={find} onChange={(e) => setFind(e.target.value)} /></div></div>
          {list.isPending ? <Spinner /> : rows.length === 0 ? <Alert tone="info">No serial numbers.</Alert> : (
            <table className="w-full text-sm" aria-label="Serial numbers"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Serial number</th><th className="py-1">Where</th><th className="py-1">Status</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-line/60"><td className="py-1.5">{r.serialNo}</td><td className="py-1.5">{ws.warehouses.find((w) => w.id === r.warehouseId)?.name ?? ''}</td><td className="py-1.5">{r.status === 'in_stock' ? 'In stock' : 'Sold or issued'}</td></tr>)}</tbody></table>)}
          {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
        </>
      ) : null}
    </div>
  )
}

function Reservations() {
  const ws = useWorkspace()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'stock:post')
  const [status, setStatus] = useState('active')
  const list = useReservations(ws.company?.id, status || undefined)
  const items = useItemsById(list.rows.map((r) => r.itemId))
  const release = useReleaseReservation(); const create = useCreateReservation()
  const flash = useFlash()
  const [adding, setAdding] = useState(false)
  const [item, setItem] = useState<Item | null>(null)
  const [wh, setWh] = useState('')
  const [qty, setQty] = useState('')
  const [ref, setRef] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const whId = wh || ws.warehouses[0]?.id || ''
  const avail = useAvailability(ws.company?.id, item?.id)
  const free = avail.data?.warehouses.find((w) => w.warehouseId === whId)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end justify-between"><div className="w-44"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'Holding stock' }, { value: 'fulfilled', label: 'Used' }, { value: 'released', label: 'Released' }, { value: '', label: 'All' }]} /></div>{canPost ? <Button onClick={() => { setProblem(null); setAdding(true) }}>Hold stock</Button> : null}</div>
      <p className="max-w-3xl text-sm text-muted">A reservation holds stock for something (such as a sales order) so it is not sold twice. Held stock still counts as on hand; it is taken off what is available.</p>
      {list.isPending ? <Spinner /> : list.rows.length === 0 ? <Alert tone="info">Nothing here.</Alert> : (
        <table className="w-full text-sm" aria-label="Reservations"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="py-1">Warehouse</th><th className="py-1 text-right">Held</th><th className="py-1 text-right">Used</th><th className="py-1">For</th><th className="py-1">Status</th><th /></tr></thead>
          <tbody>{list.rows.map((r) => <tr key={r.id} className="border-t border-line/60"><td className="py-1.5">{items.data?.get(r.itemId)?.code ?? ''}</td><td className="py-1.5">{ws.warehouses.find((w) => w.id === r.warehouseId)?.name ?? ''}</td><td className="num py-1.5 text-right">{showQty(r.quantity)}</td><td className="num py-1.5 text-right">{showQty(r.consumedQuantity)}</td><td className="py-1.5 text-muted">{r.referenceType.replaceAll('_', ' ')} {r.referenceId}</td><td className="py-1.5">{r.status}</td>
            <td className="py-1.5 text-right">{r.status === 'active' && canPost ? <Button variant="ghost" aria-label={`Release ${r.referenceId}`} onClick={async () => { try { await release.mutateAsync(r.id); flash.show('Released: the stock is available again.') } catch (e) { flash.show(msg(e, 'Could not release.')) } }}>Release</Button> : null}</td></tr>)}</tbody></table>)}
      {adding ? (
        <Drawer title="Hold stock" onClose={() => setAdding(false)}>
          <div className="flex flex-col gap-4">
            <ItemPicker label="Item" onPick={setItem} />
            <SelectField label="Warehouse" value={whId} onChange={(e) => setWh(e.target.value)} options={ws.warehouses.map((w) => ({ value: w.id, label: w.name }))} />
            {free ? <p className="text-xs text-muted" aria-label="Availability">On hand {showQty(free.onHand)}, already held {showQty(free.reserved)}, available {showQty(free.available)}</p> : null}
            <TextField label="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} /><TextField label="Held for" value={ref} onChange={(e) => setRef(e.target.value)} hint="For example the order number" />
            {problem ? <Alert>{problem}</Alert> : null}
            <Button busy={create.isPending} disabled={!item || !ws.company || !qty || !ref.trim()} onClick={async () => { if (!item || !ws.company) return; setProblem(null); try { await create.mutateAsync({ key: crypto.randomUUID(), body: { companyId: ws.company.id, warehouseId: whId, itemId: item.id, quantity: qty, referenceType: 'manual_hold', referenceId: ref.trim() } }); flash.show('Stock held.'); setAdding(false) } catch (e) { setProblem(msg(e, 'Could not hold the stock.')) } }}>Hold stock</Button>
          </div>
        </Drawer>) : null}
    </div>
  )
}

function Settings({ companyId }: { companyId: string }) {
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'stock:manage')
  const settings = useStockSettings(companyId)
  const accounts = useAccounts(companyId)
  const save = useSaveStockSettings(companyId)
  const flash = useFlash()
  const ws = useWorkspace()
  const negative = useSetNegativeStock()
  const [adj, setAdj] = useState<LedgerAccount | null | undefined>(undefined)
  const [opening, setOpening] = useState<LedgerAccount | null | undefined>(undefined)
  const [problem, setProblem] = useState<string | null>(null)
  if (settings.isPending || accounts.isPending) return <Spinner />
  const find = (id: string | null | undefined): LedgerAccount | null => accounts.data?.find((a) => a.id === id) ?? null
  const curAdj = adj === undefined ? find(settings.data?.adjustmentAccountId) : adj
  const curOpen = opening === undefined ? find(settings.data?.openingBalanceAccountId) : opening
  return (
    <Card title="Accounts used by stock entries">
      <div className="grid max-w-2xl gap-4">
        <div><AccountPicker label="Stock adjustments (gain or loss)" value={curAdj} filter={(a) => a.controlKind === null} onPick={setAdj} /><p className="mt-0.5 text-xs text-muted">The other side of a stock adjustment, such as damage or found stock.</p></div>
        <div><AccountPicker label="Opening balances" value={curOpen} filter={(a) => a.controlKind === null} onPick={setOpening} /><p className="mt-0.5 text-xs text-muted">The other side of opening stock.</p></div>
        {problem ? <Alert>{problem}</Alert> : null}
        {canManage ? <Button className="self-start" busy={save.isPending} disabled={!curAdj || !curOpen} onClick={async () => { setProblem(null); try { await save.mutateAsync({ adjustmentAccountId: curAdj?.id ?? null, openingBalanceAccountId: curOpen?.id ?? null }); flash.show('Stock accounts saved.') } catch (e) { setProblem(msg(e, 'Could not save.')) } }}>Save</Button> : null}
        <p className="text-xs text-muted">Which account suits each purpose is for your accountant to confirm.</p>
        <h3 className="mt-2 text-sm font-semibold">Selling more than is on hand</h3>
        <p className="text-xs text-muted">By default an issue that would take stock below zero is refused. A warehouse can allow it for weighted-average items, at the last cost; it is corrected when the next receipt arrives.</p>
        {ws.warehouses.map((w) => <label key={w.id} className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Allow negative stock in ${w.name}`} disabled={!canManage} checked={w.allowNegativeStock === true} onChange={async (e) => { const allow = e.target.checked; try { await negative.mutateAsync({ id: w.id, allow }); flash.show(`${w.name}: ${allow ? 'may go below zero' : 'cannot go below zero'}.`) } catch (x) { flash.show(msg(x, 'Could not change it.')) } }} />{w.name}</label>)}
      </div>
    </Card>
  )
}

export function TrackingPage() {
  const ws = useWorkspace()
  const [tab, setTab] = useState<Tab>('batches')
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Batches, serial numbers and holds</h1>
      <div role="tablist" className="flex gap-1 border-b border-line">{([['batches', 'Batches'], ['serials', 'Serial numbers'], ['reservations', 'Holds'], ['settings', 'Accounts']] as [Tab, string][]).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'batches' ? <Batches /> : tab === 'serials' ? <Serials /> : tab === 'reservations' ? <Reservations /> : <Settings companyId={ws.company.id} />}
    </div>
  )
}
