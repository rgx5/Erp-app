import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/errors'
import { send } from '@/api/send'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { useCashAccounts } from '@/features/sales/queries'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, FormActions, SelectField, Spinner, TextField } from '@/ui/primitives'

interface Item { id: string; invoiceNo: string; invoiceDate: string; customerName: string; customerId: string; currency: string; bookedRate: string; foreignOutstanding: string; bookedValue: string; rate: string | null; currentValue: string | null; unrealised: string | null }
interface Exposure { asOf: string; items: Item[]; totals: Array<{ currency: string; foreignOutstanding: string; bookedValue: string; currentValue: string | null; unrealised: string | null }> }
interface Rate { id: string; fromCurrency: string; toCurrency: string; rate: string; effectiveDate: string }
const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'That did not work. Try again.')
const plain = (r: string) => r.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
const gl = (v: string | null) => (v === null ? '—' : Number(v) === 0 ? '₹0' : `${Number(v) > 0 ? 'Gain ' : 'Loss '}${formatInr(String(Math.abs(Number(v))))}`)
const mul = (a: string, b: string) => (Math.round(Number(a) * Number(b) * 100) / 100).toFixed(2)

function RatesDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const rates = useQuery({ queryKey: ['fx-rates'], queryFn: async () => (await send<{ items: Rate[] }>('GET', '/v1/exchange-rates', { query: { limit: 100, toCurrency: 'INR' } })).items })
  const [code, setCode] = useState(''); const [rate, setRate] = useState(''); const [date, setDate] = useState(todayIso()); const [problem, setProblem] = useState<string | null>(null)
  const add = useMutation({
    mutationFn: async () => {
      const c = code.trim().toUpperCase()
      const have = (await send<{ items: Array<{ code: string }> }>('GET', '/v1/currencies', { query: { limit: 200 } })).items.map((x) => x.code)
      if (!have.includes('INR')) await send('POST', '/v1/currencies', { body: { code: 'INR', name: 'Indian rupee', decimalPlaces: 2 } })
      if (!have.includes(c)) await send('POST', '/v1/currencies', { body: { code: c, name: c, decimalPlaces: 2 } })
      return send('POST', '/v1/exchange-rates', { body: { fromCurrency: c, toCurrency: 'INR', rate: rate.trim(), effectiveDate: date } })
    },
    onSuccess: () => { setCode(''); setRate(''); void qc.invalidateQueries({ queryKey: ['fx-rates'] }); void qc.invalidateQueries({ queryKey: ['fx'] }) },
  })
  return (
    <Drawer title="Exchange rates" subtitle="Rupees for one unit of the foreign currency, on a date. The latest rate on or before an invoice date is used." onClose={onClose} width={520}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3"><TextField label="Currency" placeholder="USD" maxLength={3} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} /><TextField label="Rate (₹)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /><TextField label="From" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        {problem ? <Alert>{problem}</Alert> : null}
        <FormActions><Button disabled={!/^[A-Za-z]{3}$/.test(code) || !/^\d{1,10}(\.\d{1,8})?$/.test(rate.trim()) || code.toUpperCase() === 'INR'} busy={add.isPending} onClick={() => { setProblem(null); add.mutate(undefined, { onError: (e) => setProblem(msg(e)) }) }}>Save rate</Button></FormActions>
        {rates.isPending ? <Spinner /> : <DataTable<Rate> rows={rates.data ?? []} rowKey={(r) => r.id} empty="No rates yet." columns={[
          { id: 'c', header: 'Currency', accessorFn: (r) => r.fromCurrency, size: 90 },
          { id: 'r', header: 'Rate', accessorFn: (r) => `₹${plain(r.rate)}`, size: 110, meta: { align: 'right' } },
          { id: 'd', header: 'From', accessorFn: (r) => formatDate(r.effectiveDate), size: 120 },
        ]} />}
      </div>
    </Drawer>
  )
}

function ReceiveDrawer({ companyId, item, customerId, onClose }: { companyId: string; item: Item; customerId: string; onClose: () => void }) {
  const qc = useQueryClient(); const accounts = useCashAccounts(companyId)
  const [amount, setAmount] = useState(item.foreignOutstanding.replace(/\.?0+$/, '')); const [rate, setRate] = useState(item.rate ? plain(item.rate) : ''); const [date, setDate] = useState(todayIso()); const [bank, setBank] = useState(''); const [problem, setProblem] = useState<string | null>(null)
  const okNums = /^\d{1,14}(\.\d{1,4})?$/.test(amount.trim()) && Number(amount) > 0 && /^\d{1,10}(\.\d{1,8})?$/.test(rate.trim()) && Number(rate) > 0
  const inr = okNums ? mul(amount, rate) : null
  const save = useMutation({
    mutationFn: () => send('POST', '/v1/receivables/receipts', { body: { companyId, customerId, receiptDate: date, amount: inr, method: 'bank_transfer', depositAccountId: bank, foreign: { currency: item.currency, amount: amount.trim(), rate: rate.trim() }, allocations: [{ invoiceId: item.id, amount: amount.trim() }] } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['fx'] }); void qc.invalidateQueries({ queryKey: ['invoices'] }); void qc.invalidateQueries({ queryKey: ['receipts'] }); void qc.invalidateQueries({ queryKey: ['position'] }); void qc.invalidateQueries({ queryKey: ['trial-balance'] }); onClose() },
  })
  const diff = inr ? Number(inr) - (Number(item.bookedValue) * Number(amount)) / Number(item.foreignOutstanding) : null
  return (
    <Drawer title={`Receive payment for ${item.invoiceNo}`} subtitle={`${item.customerName} · ${item.foreignOutstanding.replace(/\.?0+$/, '')} ${item.currency} owed`} onClose={onClose} width={440}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4"><TextField label={`Amount received (${item.currency})`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /><TextField label="Rate on the day (₹)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-4"><TextField label="Received on" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><SelectField label="Into account" value={bank} onChange={(e) => setBank(e.target.value)} options={[{ value: '', label: 'Choose…' }, ...(accounts.data ?? []).map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` }))]} /></div>
        {inr ? <p className="text-sm text-muted">The bank gets <b className="num text-ink">{formatInr(inr)}</b>{diff !== null && Math.abs(diff) >= 0.005 ? <> · this books an exchange {diff > 0 ? 'gain' : 'loss'} of <b className="num text-ink">{formatInr(String(Math.abs(diff)))}</b></> : null}.</p> : null}
        {problem ? <Alert>{problem}</Alert> : null}
        <FormActions><Button disabled={!okNums || !bank} busy={save.isPending} onClick={() => { setProblem(null); save.mutate(undefined, { onError: (e) => setProblem(msg(e)) }) }}>Record payment</Button></FormActions>
      </div>
    </Drawer>
  )
}

/** Money owed in foreign currencies, valued at today's rate, with the exchange rates it is valued at. */
export function FxPage() {
  const ws = useWorkspace(); const companyId = ws.company?.id
  const perms = useSession((s) => s.me?.permissions ?? [])
  const [asOf, setAsOf] = useState(todayIso()); const [rates, setRates] = useState(false); const [receive, setReceive] = useState<Item | null>(null)
  const q = useQuery({ queryKey: ['fx', 'exposure', companyId, asOf], enabled: Boolean(companyId), queryFn: () => send<Exposure>('GET', '/v1/fx/exposure', { query: { companyId, asOf } }) })
  const rows = useMemo(() => q.data?.items ?? [], [q.data])
  const columns = useMemo<ColumnDef<Item, unknown>[]>(() => [
    { id: 'invoice', header: 'Invoice', accessorFn: (r) => `${r.invoiceNo} · ${formatDate(r.invoiceDate)}`, size: 190 },
    { id: 'customer', header: 'Customer', accessorFn: (r) => r.customerName, size: 200 },
    { id: 'owed', header: 'Owed', accessorFn: (r) => `${r.foreignOutstanding.replace(/\.?0+$/, '')} ${r.currency}`, size: 130, meta: { align: 'right' } },
    { id: 'booked', header: 'Booked at', accessorFn: (r) => `${formatInr(r.bookedValue)} @ ₹${r.bookedRate}`, size: 190, meta: { align: 'right' } },
    { id: 'now', header: 'Worth now', accessorFn: (r) => (r.currentValue === null ? 'No rate' : `${formatInr(r.currentValue)} @ ₹${plain(r.rate ?? '')}`), size: 190, meta: { align: 'right' } },
    { id: 'gl', header: 'Not yet realised', accessorFn: (r) => gl(r.unrealised), size: 150, meta: { align: 'right' } },
    { id: 'act', header: '', size: 110, cell: ({ row }) => (can(perms, 'receivables:post') ? <Button variant="secondary" onClick={() => setReceive(row.original)}>Receive</Button> : null) },
  ], [perms])
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="page-title">Foreign currency</h1><p className="page-sub">What customers owe you in other currencies, valued at the latest rate. The gain or loss is booked only when they pay.</p></div>
        <div className="flex items-end gap-2"><TextField label="As of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />{can(perms, 'masterdata:write') ? <Button variant="ghost" onClick={() => setRates(true)}>Exchange rates</Button> : null}</div>
      </div>
      {q.data && q.data.totals.length ? (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-4">
          {q.data.totals.map((t) => <div key={t.currency}><dt className="text-muted">{t.currency} owed</dt><dd className="num text-base font-semibold">{t.foreignOutstanding.replace(/\.?0+$/, '')}</dd><dd className="text-xs text-muted">{t.currentValue ? `${formatInr(t.currentValue)} · ${gl(t.unrealised)}` : 'No rate on this date'}</dd></div>)}
        </dl>
      ) : null}
      {q.isPending ? <Spinner /> : <DataTable<Item> rows={rows} rowKey={(r) => r.id} empty="Nothing is owed in a foreign currency." columns={columns} />}
      {rates ? <RatesDrawer onClose={() => setRates(false)} /> : null}
      {receive && companyId ? <ReceiveDrawer companyId={companyId} item={receive} customerId={receive.customerId} onClose={() => setReceive(null)} /> : null}
    </div>
  )
}
