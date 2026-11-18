import { Trash2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { lookupItem } from '@/features/masterdata/queries'
import { query } from '@/api/client'
import { ApiError, NetworkError } from '@/api/errors'
import { item as itemSchema, page, type Item, type PosSaleResult, type PosShift, type PosTerminal } from '@/api/schemas'
import { POS_METHODS } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { currentApi, useSession } from '@/auth/session'
import { bridge } from '@/bridge'
import { formatInr, todayIso } from '@/domain/format'
import { stateName } from '@/domain/india'
import { compare, isValid, sub, sum } from '@/domain/money'
import { usePriceLists, usePrices } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import type { Seller } from '@/features/sales/invoiceHtml'
import { useCalculation } from '@/features/sales/queries'
import { useFlash } from '@/ui/flash'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { loadParked, saveParked, type ParkedBill } from './counterStore'
import { receiptText, whatsappUrl } from './share'
import { counterState, loadCatalogue, loadQueue, saveCatalogue, saveCounterState, saveQueue, type CachedItem, type QueuedSale } from './counterStore'
import { ReturnDrawer } from './ReturnDrawer'
import { CloseShiftDrawer } from './ShiftDrawers'
import { fetchCatalogue, postSale, uploadBatch, useOpenShift, usePosSettings, useShifts, useTerminals } from './queries'
import { receiptHtml } from './receiptHtml'
import { localTotal, serialList, trackingReady, type CartLine } from './totals'
import { useCustomerWallet } from '@/features/retail/queries'
import { WalletPanel } from './WalletPanel'
import { grossOf, noWallet, pointsValue, walletInUse, withWalletDiscount, type WalletChoice } from './wallet'
import { toUnits } from '@/domain/money'
import { useBatches } from '@/features/inventory/trackingQueries'

interface Tender { key: string; method: string; amount: string; tendered: string }
const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' }
let n = 0
const newTender = (method = 'cash'): Tender => ({ key: `t${++n}`, method, amount: '', tendered: '' })
const msg = (e: unknown, f: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : e instanceof Error ? e.message : f)

async function lookup(q: string): Promise<Item[]> {
  const api = currentApi()
  const r = await api.call(api.raw.GET('/v1/items', { params: { query: query({ q, status: 'active', limit: 20 }) } }), page(itemSchema))
  return r.items.filter((i) => i.isSellable)
}

export function CounterPage() {
  const ws = useWorkspace()
  const tenant = useSession((s) => s.tenant ?? 'default')
  const perms = useSession((s) => s.me?.permissions ?? [])
  const flash = useFlash()
  const qc = useQueryClient()
  const company = ws.company
  const terminals = useTerminals(company?.id)
  const openShifts = useShifts(company?.id, 'open')
  const priceLists = usePriceLists()
  const open = useOpenShift()

  const saved = counterState(tenant)
  const [terminalId, setTerminalId] = useState(saved.terminalId ?? '')
  const [priceListId, setPriceListId] = useState(saved.priceListId ?? '')
  const [opening, setOpening] = useState('0')
  const [problem, setProblem] = useState<string | null>(null)
  const [wallet, setWallet] = useState<WalletChoice>(noWallet())
  const [parked, setParked] = useState<ParkedBill[]>(() => loadParked(tenant))
  const [showParked, setShowParked] = useState(false)
  const [phone, setPhone] = useState('')

  const terminal: PosTerminal | undefined = terminals.data?.find((t) => t.id === terminalId) ?? terminals.data?.find((t) => t.status === 'active')
  const shift: PosShift | undefined = openShifts.rows.find((s) => s.terminalId === terminal?.id)
  const prices = usePrices(priceListId || undefined)
  const priceList = priceLists.data?.find((p) => p.id === priceListId)

  const [cart, setCart] = useState<CartLine[]>([])
  const [tenders, setTenders] = useState<Tender[]>([newTender()])
  const [scan, setScan] = useState('')
  const [found, setFound] = useState<Item[]>([])
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<PosSaleResult | null>(null)
  const [queue, setQueue] = useState<QueuedSale[]>(() => loadQueue(tenant))
  const [panel, setPanel] = useState<null | 'return'>(null)
  const [closing, setClosing] = useState<PosShift | null>(null)
  const [syncing, setSyncing] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)
  const chargeRef = useRef<() => void>(() => undefined)

  const today = todayIso()
  const priceFrom = (list: { itemId: string; minQty: string; price: string; effectiveFrom: string; effectiveTo: string | null }[], itemId: string): string | null => {
    const rows = list.filter((p) => p.itemId === itemId && p.effectiveFrom <= today && (!p.effectiveTo || p.effectiveTo >= today) && Number(p.minQty) <= 1).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
    return rows[0]?.price ?? null
  }
  const priceOf = (itemId: string): string | null => priceFrom(prices.data ?? [], itemId)
  const taxInclusive = priceList?.taxInclusive ?? true

  async function addItem(i: { id: string; code: string; name: string; taxCodeId: string | null; tracking?: string; mrp?: string | null | undefined }, price?: string | null, noDiscount = false) {
    const tracking = (i.tracking === 'batch' || i.tracking === 'serial' ? i.tracking : 'none') as CartLine['tracking']
    const listed = price ?? priceOf(i.id)
    // with no price-list price the printed MRP (tax included) is used, so a shelf item can be sold before any price list exists
    const p = listed ?? (i.mrp ? String(Number(i.mrp)) : null)
    const inclusive = listed === null && i.mrp ? true : taxInclusive
    setCart((c) => {
      const same = tracking === 'serial' ? undefined : c.find((l) => l.itemId === i.id && (l.unitPrice === (p ?? '') || l.unitPrice === ''))
      return same ? c.map((l) => (l === same ? { ...l, quantity: String(Number(l.quantity) + 1) } : l)) : [...c, { key: `l${++n}`, itemId: i.id, code: i.code, name: i.name, quantity: '1', unitPrice: p ?? '', discountPercent: '0', taxInclusive: inclusive, taxCodeId: i.taxCodeId, tracking, batchId: '', serials: '', noDiscount }]
    })
    setFound([])
  }
  async function onScan() {
    const text = scan.trim()
    if (!text) return
    setScan(''); setProblem(null) // cleared at once so a fast scanner can send the next code
    try {
      const hit = await lookupItem(text) // a barcode, or an item code
      if (hit && hit.item.isSellable) { await addItem(hit.item, undefined, hit.noDiscount); return }
      const rows = await lookup(text)
      const exact = rows.find((r) => r.code.toLowerCase() === text.toLowerCase())
      if (exact) await addItem(exact)
      else if (rows.length === 1 && rows[0]) await addItem(rows[0])
      else if (rows.length === 0) setProblem(`Nothing matches "${text}".`)
      else setFound(rows.slice(0, 8))
    } catch (e) {
      if (e instanceof NetworkError) {
        const all = loadCatalogue(tenant)
        const byBarcode = all.find((c) => (c.barcodes ?? []).some((b) => b.toLowerCase() === text.toLowerCase()))
        if (byBarcode) { if (byBarcode.tracking !== 'none') setProblem(`${byBarcode.code} is batch or serial tracked: it can only be sold while online.`); else await addItem({ ...byBarcode, taxCodeId: byBarcode.taxCodeId }, byBarcode.price, byBarcode.noDiscount === true); return }
        const cached = all.filter((c) => c.code.toLowerCase() === text.toLowerCase() || c.name.toLowerCase().includes(text.toLowerCase()))
        const exact = cached.find((c) => c.code.toLowerCase() === text.toLowerCase())
        if (exact && exact.tracking !== 'none') setProblem(`${exact.code} is batch or serial tracked: it can only be sold while online.`)
        else if (exact) await addItem({ ...exact, taxCodeId: exact.taxCodeId }, exact.price, exact.noDiscount === true)
        else if (cached.length === 1 && cached[0] && cached[0].tracking !== 'none') setProblem(`${cached[0].code} is batch or serial tracked: it can only be sold while online.`)
        else if (cached.length === 1 && cached[0]) await addItem(cached[0], cached[0].price, cached[0].noDiscount === true)
        else if (cached.length === 0) setProblem(`Offline, and "${text}" is not in the saved catalogue.`)
        else setFound(cached.slice(0, 8) as unknown as Item[])
      } else setProblem(msg(e, 'Could not search.'))
    }
  }

  // ---- totals: the server's own calculation while online, the till's fallback otherwise ----
  const priced = cart.length > 0 && cart.every((l) => isValid(l.unitPrice) && l.unitPrice !== '' && Number(l.quantity) > 0)
  const tracked = cart.every(trackingReady)
  const walletQ = useCustomerWallet(company?.id, wallet.customerId || undefined)
  const ptsOk = /^\d{1,8}(\.\d{1,2})?$/.test(wallet.points) && walletQ.data !== undefined && Number(wallet.points) <= Number(walletQ.data.loyalty.points)
  const ptsDisc = ptsOk && walletQ.data ? pointsValue(wallet.points, walletQ.data.loyalty.rupeesPerPoint) : 0n
  const couponDisc = wallet.coupon ? toUnits(wallet.coupon.discount) : 0n
  const gross = useMemo(() => (priced ? grossOf(cart) : '0'), [priced, cart])
  const effLines = useMemo(() => withWalletDiscount(cart, couponDisc + ptsDisc), [cart, couponDisc, ptsDisc])
  useEffect(() => { setWallet((w) => (w.coupon ? { ...w, coupon: null } : w)) }, [gross]) // the cart changed: the coupon has to be checked again
  const body = useMemo(() => (company && terminal && priced && ws.company ? {
    companyId: company.id, gstRegistrationId: terminal.gstRegistrationId, customerId: '', invoiceDate: today,
    lines: effLines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, warehouseId: terminal.warehouseId })),
  } : null), [company, terminal, priced, effLines, today, ws.company])
  const walkIn = usePosSettings(company?.id).data?.settings?.walkInCustomerId ?? null
  const calc = useCalculation(body && (wallet.customerId || walkIn) ? ({ ...body, customerId: wallet.customerId || walkIn } as never) : null)
  const offline = calc.isError && calc.error instanceof NetworkError
  const local = priced ? localTotal(cart) : null
  const total = calc.data && !offline ? calc.data.totals.grandTotal : local?.grandTotal ?? '0'
  const totalKnown = priced && (Boolean(calc.data) || offline || (!walkIn && Boolean(local)))

  // ---- tenders ----
  const credit = wallet.useCredit && walletQ.data && !offline ? (compare(walletQ.data.storeCredit, total) < 0 ? walletQ.data.storeCredit : total) : '0'
  const due = sub(total, credit)
  const amountOf = (t: Tender): string => (t.amount !== '' ? t.amount : tenders.length === 1 ? due : '0')
  const paid = sum(tenders.map((t) => { const a = amountOf(t); return isValid(a) ? a : '0' }))
  const remaining = compare(due, '0') === 0 ? '0' : sub(due, paid)
  const cashRow = tenders.find((t) => t.method === 'cash')
  const change = cashRow && isValid(cashRow.tendered) && cashRow.tendered !== '' ? (compare(cashRow.tendered, amountOf(cashRow)) > 0 ? sub(cashRow.tendered, amountOf(cashRow)) : '0') : '0'
  const ready = tracked && totalKnown && Number(total) > 0 && compare(remaining, '0') === 0 && (compare(due, '0') === 0 ? Number(credit) > 0 : tenders.every((t) => isValid(amountOf(t)) && Number(amountOf(t)) > 0))

  function seller(res: PosSaleResult): Seller | null {
    const doc = res.invoice ?? res.creditNote
    if (!doc || !company) return null
    const reg = ws.registrations.find((r) => r.id === doc.gstRegistrationId)
    const loc = ws.locations.find((l) => l.gstRegistrationId === doc.gstRegistrationId && l.isPrincipalPlace) ?? ws.locations.find((l) => l.gstRegistrationId === doc.gstRegistrationId)
    return { name: reg?.legalName ?? company.legalName, tradeName: reg?.tradeName ?? company.tradeName, gstin: reg?.gstin ?? '', stateCode: reg?.stateCode ?? '', address: loc ? [loc.address.line1, loc.address.line2 ?? '', loc.address.city, stateName(loc.address.stateCode), loc.address.pincode].filter(Boolean) : [] }
  }
  async function print(res: PosSaleResult) { const s = seller(res); const doc = res.invoice ?? res.creditNote; if (!s || !doc) return; try { await bridge.document.savePdf(receiptHtml(res, s), doc.invoiceNo.replaceAll('/', '-')) } catch (e) { setProblem(msg(e, 'Could not print the receipt.')) } }

  function hold() {
    if (cart.length === 0) return
    const bill: ParkedBill = { id: crypto.randomUUID(), at: new Date().toISOString(), label: cart.map((l) => `${l.code} x${l.quantity}`).join(', '), cart }
    const next = [...parked, bill]
    if (!saveParked(tenant, next)) { setProblem('This computer cannot keep the bill aside. Charge it, or write it down.'); return }
    setParked(next); setCart([]); setTenders([newTender()]); setWallet(noWallet()); flash.show('Bill held. Recall it from Held bills.'); scanRef.current?.focus()
  }
  function recall(b: ParkedBill) {
    if (cart.length > 0) { setProblem('Charge or hold the current bill before recalling another.'); return }
    const next = parked.filter((x) => x.id !== b.id)
    saveParked(tenant, next); setParked(next); setCart(b.cart); setShowParked(false); setProblem(null)
  }
  function dropHeld(b: ParkedBill) { const next = parked.filter((x) => x.id !== b.id); saveParked(tenant, next); setParked(next) }
  function whatsapp(res: PosSaleResult) {
    const url = whatsappUrl(phone, receiptText(res, company?.tradeName || company?.legalName || 'Receipt'))
    if (!url) { setProblem('Enter the customer\'s mobile number first.'); return }
    window.open(url, '_blank', 'noopener')
  }

  async function charge() {
    if (!ready || !shift || busy) return
    setBusy(true); setProblem(null)
    const payments = compare(due, '0') === 0 ? [] : tenders.map((t) => ({ method: t.method, amount: amountOf(t), ...(t.method === 'cash' && isValid(t.tendered) && t.tendered !== '' ? { tendered: t.tendered } : {}) }))
    const lines = effLines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive, warehouseId: terminal?.warehouseId, ...(l.tracking === 'batch' ? { batchId: l.batchId } : {}), ...(l.tracking === 'serial' ? { serialNos: serialList(l.serials) } : {}) }))
    const clientId = crypto.randomUUID()
    try {
      const res = await postSale({ shiftId: shift.id, lines, payments, ...(wallet.customerId ? { customerId: wallet.customerId } : {}), ...(wallet.coupon ? { couponCode: wallet.coupon.code } : {}), ...(ptsDisc > 0n ? { loyaltyPoints: wallet.points } : {}), ...(Number(credit) > 0 ? { storeCredit: credit } : {}) }, clientId)
      setLast(res); setCart([]); setTenders([newTender()]); setWallet(noWallet()); scanRef.current?.focus()
      void qc.invalidateQueries({ queryKey: ['pos'] }); void qc.invalidateQueries({ queryKey: ['retail'] })
    } catch (e) {
      const deviceId = counterState(tenant).deviceId
      if (e instanceof NetworkError && walletInUse(wallet)) setProblem('No connection. A sale that uses store credit, points or a coupon has to be recorded online: take the wallet off to sell offline.')
      else if (e instanceof NetworkError && deviceId) {
        const item: QueuedSale = { clientId, shiftId: shift.id, occurredAt: new Date().toISOString(), payload: { lines: lines.map(({ warehouseId: _w, ...r }) => r), payments }, label: cart.map((l) => `${l.code} x${l.quantity}`).join(', '), total }
        const next = [...queue, item]
        if (saveQueue(tenant, next)) { setQueue(next); setLast(null); setCart([]); setTenders([newTender()]); flash.show('No connection: the sale is saved on this computer and will upload when you sync.') } else setProblem('No connection, and this computer cannot save the sale. Do not hand over the goods until it is recorded.')
      } else if (e instanceof NetworkError) setProblem('No connection. To sell offline, ask a manager to register this counter as a device in POS setup, then sync once while online.')
      else if (e instanceof ApiError && e.code === 'payment_mismatch') setProblem(`The payments must add up to the sale total of ${formatInr(String(e.extra['total'] ?? total))}.`)
      else setProblem(msg(e, 'The sale was not recorded.'))
    } finally { setBusy(false) }
  }
  chargeRef.current = () => { void charge() }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'F9') { e.preventDefault(); chargeRef.current() } else if (e.key === 'F2') { e.preventDefault(); scanRef.current?.focus() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function sync() {
    const deviceId = counterState(tenant).deviceId
    if (!deviceId) { setProblem('This counter is not registered as a device. Ask a manager to register it in POS setup.'); return }
    setSyncing(true); setProblem(null)
    try {
      let rest = [...queue]
      for (const shiftId of new Set(queue.map((q) => q.shiftId))) {
        const mine = queue.filter((q) => q.shiftId === shiftId)
        for (let i = 0; i < mine.length; i += 50) {
          const chunk = mine.slice(i, i + 50)
          const r = await uploadBatch({ deviceId, shiftId, items: chunk.map((c) => ({ clientId: c.clientId, kind: 'sale', occurredAt: c.occurredAt, payload: c.payload })) })
          for (const res of r.results) {
            if (res.status === 'applied' || res.status === 'duplicate') rest = rest.filter((q) => q.clientId !== res.clientId)
            else rest = rest.map((q) => (q.clientId === res.clientId ? { ...q, error: res.message ?? res.reason ?? res.code ?? 'Rejected by the server' } : q))
          }
        }
      }
      saveQueue(tenant, rest); setQueue(rest)
      void qc.invalidateQueries({ queryKey: ['pos'] })
      flash.show(rest.length === 0 ? 'Everything is uploaded.' : `${rest.length} sale(s) still need attention.`)
    } catch (e) { setProblem(e instanceof NetworkError ? 'Still no connection.' : msg(e, 'Could not upload.')) } finally { setSyncing(false) }
  }
  async function prepareOffline() {
    const deviceId = counterState(tenant).deviceId
    if (!deviceId) { setProblem('Register this counter as a device in POS setup first.'); return }
    try {
      const cat = await fetchCatalogue(deviceId)
      const list = priceListId ? prices.data ?? (await prices.refetch()).data ?? [] : []
      const items: CachedItem[] = cat.items.filter((i) => i.status === 'active').map((i) => ({ id: i.id, code: i.code, name: i.name, taxCodeId: i.taxCodeId, price: priceFrom(list, i.id), taxInclusive, tracking: i.tracking, mrp: i.mrp ?? null, noDiscount: i.noDiscount === true, barcodes: (cat.barcodes ?? []).filter((b) => b.itemId === i.id).map((b) => b.barcode) }))
      if (!saveCatalogue(tenant, items)) { setProblem('This computer has no room to save the catalogue.'); return }
      flash.show(`${items.length} items saved for selling offline.`)
    } catch (e) { setProblem(msg(e, 'Could not download the catalogue.')) }
  }

  if (ws.loading || terminals.isPending || openShifts.isPending) return <Spinner />
  if (!company) return <Alert tone="info">Set up your business first.</Alert>
  if (!terminal) return <Alert tone="info">No counter yet. <Link to="/pos/admin" className="underline">Create a terminal in POS setup</Link>.</Alert>
  if (!can(perms, 'pos:sell')) return <Alert tone="info">You do not have the right to sell at the counter.</Alert>

  if (!shift) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <h1 className="text-lg font-semibold">Counter</h1>
        <Card title="Open a shift">
          <div className="flex flex-col gap-4">
            <SelectField label="Terminal" value={terminal.id} onChange={(e) => { setTerminalId(e.target.value); saveCounterState(tenant, { terminalId: e.target.value }) }} options={(terminals.data ?? []).filter((t) => t.status === 'active').map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))} />
            <SelectField label="Sell from price list" value={priceListId} onChange={(e) => { setPriceListId(e.target.value); saveCounterState(tenant, { priceListId: e.target.value }) }} options={[{ value: '', label: 'None: key every price' }, ...(priceLists.data ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: `${p.name}${p.taxInclusive ? ' (prices include tax)' : ''}` }))]} />
            <TextField label="Cash in the drawer" value={opening} onChange={(e) => setOpening(e.target.value)} hint="Count it before you start" />
            {problem ? <Alert>{problem}</Alert> : null}
            <Button busy={open.isPending} disabled={!isValid(opening)} onClick={async () => { setProblem(null); try { const s = await open.mutateAsync({ body: { terminalId: terminal.id, openingCash: opening || '0' }, key: crypto.randomUUID() }); flash.show(`${s.shiftNo} opened.`); await prepareOffline() } catch (e) { setProblem(msg(e, 'Could not open the shift.')) } }}>Open shift</Button>
          </div>
        </Card>
        {queue.length ? <Alert>{queue.length} offline sale(s) from an earlier shift are waiting to upload. They upload against the shift they were made in.</Alert> : null}
        {closing ? <CloseShiftDrawer shift={closing} onClose={() => setClosing(null)} /> : null}
      </div>
    )
  }

  const cell = 'h-8 rounded border border-line bg-surface px-2 text-right text-sm'
  return (
    <div className="grid h-full grid-cols-[1fr_360px] gap-4">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{terminal.name} <span className="text-sm font-normal text-muted">· {shift.shiftNo}{priceList ? ` · ${priceList.name}` : ''}</span></h1>
          <div className="flex items-center gap-2">
            <span className={`rounded px-2 py-0.5 text-xs ${offline ? 'bg-bad/10 text-bad' : 'bg-good/10 text-good'}`}>{offline ? 'Offline' : 'Online'}</span>
            {queue.length ? <Button variant="secondary" busy={syncing} onClick={() => void sync()}>Upload {queue.length} offline sale{queue.length === 1 ? '' : 's'}</Button> : null}
            <Button variant="secondary" disabled={cart.length === 0} onClick={hold}>Hold bill</Button>
            <Button variant="secondary" onClick={() => setShowParked(!showParked)}>Held bills ({parked.length})</Button>
            <Button variant="secondary" onClick={() => setPanel('return')}>Return</Button>
            <Button variant="secondary" onClick={() => setClosing(shift)}>Close shift</Button>
          </div>
        </div>
        <div className="relative">
          <TextField ref={scanRef} label="Scan or type item code or name (F2)" value={scan} autoFocus disabled={Boolean(priceListId) && prices.isPending} hint={priceListId && prices.isPending ? 'Loading prices…' : undefined} autoComplete="off" onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void onScan() } }} />
          {found.length ? (
            <ul role="listbox" aria-label="Matches" className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border border-line bg-surface text-sm shadow-lg">
              {found.map((i) => <li key={i.id}><button type="button" role="option" aria-selected={false} className="flex w-full justify-between px-3 py-1.5 text-left hover:bg-canvas" onClick={() => void addItem(i)}><span>{i.code} · {i.name}</span><span className="text-muted">{priceOf(i.id) ? formatInr(priceOf(i.id) as string) : 'no price'}</span></button></li>)}
            </ul>
          ) : null}
        </div>
        {problem ? <Alert>{problem}</Alert> : null}
        {calc.isError && !offline ? <Alert>{calc.error instanceof ApiError ? calc.error.message : 'Could not work out the total.'}</Alert> : null}
        {showParked ? (
          <Alert tone="info"><div className="flex flex-col gap-1" aria-label="Held bills">{parked.length === 0 ? 'No bills are held.' : parked.map((b) => <div key={b.id} className="flex items-center justify-between gap-3 text-sm"><span>{new Date(b.at).toLocaleTimeString()} · {b.label}</span><span><Button variant="ghost" onClick={() => recall(b)}>Recall</Button><Button variant="ghost" aria-label={`Discard held bill ${b.label}`} onClick={() => dropHeld(b)}>Discard</Button></span></div>)}</div></Alert>
        ) : null}
        {last ? (
          <Alert tone="info"><span aria-label="Last sale">{(last.invoice ?? last.creditNote)?.invoiceNo} · {formatInr((last.invoice ?? last.creditNote)?.grandTotal ?? '0')}{last.changeDue && Number(last.changeDue) > 0 ? ` · change ${formatInr(last.changeDue)}` : ''}</span> <Button variant="ghost" onClick={() => void print(last)}>{window.onesync ? 'Save receipt as PDF' : 'Print receipt'}</Button> <input aria-label="Customer mobile for WhatsApp" inputMode="tel" placeholder="Mobile number" className="h-8 w-36 rounded border border-line bg-surface px-2 text-sm" value={phone} onChange={(e) => setPhone(e.target.value)} /> <Button variant="ghost" onClick={() => whatsapp(last)}>Send on WhatsApp</Button></Alert>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm" aria-label="Cart">
            <thead><tr className="bg-canvas text-left text-xs text-muted"><th className="p-2">Item</th><th className="w-20 p-2 text-right">Qty</th><th className="w-28 p-2 text-right">Price</th><th className="w-20 p-2 text-right">Disc %</th><th className="w-28 p-2 text-right">Amount</th><th className="w-8" /></tr></thead>
            <tbody>
              {cart.length === 0 ? <tr><td colSpan={6} className="p-6 text-center text-muted">Scan an item to begin.</td></tr> : cart.map((l) => {
                const set = (p: Partial<CartLine>): void => setCart(cart.map((x) => (x.key === l.key ? { ...x, ...p } : x)))
                const row = calc.data && !offline ? calc.data.lines[cart.indexOf(l)] : undefined
                return (
                  <Fragment key={l.key}>
                  <tr className="border-t border-line/60">
                    <td className="p-2">{l.code} · {l.name}</td>
                    <td className="p-1 text-right"><input aria-label={`Quantity of ${l.code}`} inputMode="decimal" className={`${cell} w-20`} value={l.quantity} onChange={(e) => set({ quantity: e.target.value })} /></td>
                    <td className="p-1 text-right"><input aria-label={`Price of ${l.code}`} inputMode="decimal" className={`${cell} w-28 ${l.unitPrice === '' ? 'border-bad' : ''}`} value={l.unitPrice} placeholder="price" onChange={(e) => set({ unitPrice: e.target.value })} /></td>
                    <td className="p-1 text-right"><input aria-label={`Discount of ${l.code}`} inputMode="decimal" disabled={l.noDiscount === true} title={l.noDiscount ? 'No discount is allowed on this item' : undefined} className={`${cell} w-20 disabled:opacity-50`} value={l.discountPercent} onChange={(e) => set({ discountPercent: e.target.value })} /></td>
                    <td className="num p-2 text-right">{row ? formatInr(row.lineTotal, { symbol: false }) : ''}</td>
                    <td className="p-1"><button type="button" aria-label={`Remove ${l.code}`} className="grid size-7 place-items-center rounded text-muted hover:text-bad" onClick={() => setCart(cart.filter((x) => x.key !== l.key))}><Trash2 className="size-4" /></button></td>
                  </tr>
                  {l.tracking !== 'none' ? <tr><td colSpan={6} className="px-2 pb-2"><LineTracking line={l} set={set} /></td></tr> : null}
                  </Fragment>)
              })}
            </tbody>
          </table>
        </div>
        {queue.some((q) => q.error) ? <Alert>{queue.filter((q) => q.error).map((q) => <div key={q.clientId}>{q.label} ({formatInr(q.total)}): {q.error}</div>)}Sales that were rejected are not in the books. Ask a manager before handing over the goods again.</Alert> : null}
      </div>

      <div className="flex flex-col gap-3">
        <Card title="Total">
          <div className="text-right"><div className="text-3xl font-semibold num" aria-label="Sale total">{formatInr(total)}</div>
            {calc.data && !offline && Number(calc.data.totals.roundOff) !== 0 ? <div className="text-xs text-muted">includes round off {formatInr(calc.data.totals.roundOff)}</div> : null}
            {offline ? <div className="text-xs text-bad">Offline: total worked out on this computer</div> : null}
            {cart.length > 0 && !priced ? <div className="text-xs text-bad">Enter a price for every line</div> : null}</div>
        </Card>
        {company ? <WalletPanel companyId={company.id} gross={gross} choice={wallet} onChange={setWallet} offline={offline} pointsDiscount={ptsDisc} /> : null}
        <Card title="Payment">
          <div className="flex flex-col gap-2">
            {tenders.map((t) => (
              <div key={t.key} className="grid items-end gap-2" style={{ gridTemplateColumns: '1fr 1fr 24px' }}>
                <SelectField label="Method" value={t.method} onChange={(e) => setTenders(tenders.map((x) => (x.key === t.key ? { ...x, method: e.target.value } : x)))} options={POS_METHODS.map((m) => ({ value: m, label: METHOD[m] ?? m }))} />
                <TextField label="Amount" inputMode="decimal" value={t.amount !== '' ? t.amount : tenders.length === 1 ? (due === '0' ? '' : due) : ''} onChange={(e) => setTenders(tenders.map((x) => (x.key === t.key ? { ...x, amount: e.target.value } : x)))} />
                {tenders.length > 1 ? <button type="button" aria-label="Remove payment" className="mb-2 text-muted hover:text-bad" onClick={() => setTenders(tenders.filter((x) => x.key !== t.key))}>×</button> : <span />}
                {t.method === 'cash' ? <div className="col-span-2"><TextField label="Cash given" inputMode="decimal" value={t.tendered} onChange={(e) => setTenders(tenders.map((x) => (x.key === t.key ? { ...x, tendered: e.target.value } : x)))} /></div> : null}
              </div>))}
            <Button variant="ghost" className="self-start" onClick={() => setTenders([...tenders, newTender('upi')])}>+ Split payment</Button>
            <dl className="text-sm">{Number(credit) > 0 ? <div className="flex justify-between"><dt className="text-muted">Store credit used</dt><dd className="num" aria-label="Store credit used">{formatInr(credit)}</dd></div> : null}<div className="flex justify-between"><dt className="text-muted">Still to pay</dt><dd className="num">{formatInr(remaining)}</dd></div>{Number(change) > 0 ? <div className="flex justify-between font-semibold"><dt>Change</dt><dd className="num" aria-label="Change due">{formatInr(change)}</dd></div> : null}</dl>
          </div>
        </Card>
        <Button className="h-12 text-base" disabled={!ready} busy={busy} onClick={() => void charge()}>Charge {formatInr(total)} (F9)</Button>
        <Button variant="ghost" onClick={() => void prepareOffline()}>Save catalogue for offline selling</Button>
      </div>
      {panel === 'return' ? <ReturnDrawer shift={shift} onClose={() => setPanel(null)} /> : null}
      {closing ? <CloseShiftDrawer shift={closing} onClose={() => setClosing(null)} /> : null}
    </div>
  )
}

function LineTracking({ line, set }: { line: CartLine; set: (p: Partial<CartLine>) => void }) {
  const batches = useBatches(line.tracking === 'batch' ? line.itemId : undefined)
  if (line.tracking === 'serial') {
    const list = serialList(line.serials)
    return <textarea aria-label={`Serial numbers of ${line.code}`} rows={1} placeholder={`Scan the serial number of each ${line.code} (${list.length} of ${line.quantity})`} className="w-full rounded border border-line bg-surface px-2 py-1 text-sm" value={line.serials} onChange={(e) => set({ serials: e.target.value, quantity: String(Math.max(1, serialList(e.target.value).length)) })} />
  }
  return <select aria-label={`Batch of ${line.code}`} className="h-8 w-full rounded border border-line bg-surface px-2 text-sm" value={line.batchId} onChange={(e) => set({ batchId: e.target.value })}><option value="">Choose the batch of {line.code}…</option>{(batches.data ?? []).filter((b) => b.status === 'active').map((b) => <option key={b.id} value={b.id}>{b.batchNo}{b.expiryDate ? ` (expires ${b.expiryDate})` : ''}</option>)}</select>
}
