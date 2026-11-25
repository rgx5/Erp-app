import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMemo, useState, type ReactNode } from 'react'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { useBills, useGoodsReceipts, usePayments, usePurchaseOrders, useSupplierPosition, useSupplierStatement } from '@/features/purchasing/queries'
import { useChallans, useOrders, useQuotes } from '@/features/sales/orderQueries'
import { useInvoices, usePosition, useReceipts, useStatement } from '@/features/sales/queries'
import { DOC_LABEL } from '@/features/sales/InvoicesPage'
import { AttachmentsPanel } from '@/features/attachments/AttachmentsPanel'
import { Drawer } from '@/ui/Drawer'
import { Alert, Button, Card, Spinner } from '@/ui/primitives'
import { PartyForm, roleLabel, treatmentLabel } from './PartyForm'
import { usePartyAddresses, useParty } from './queries'

const fyStart = (): string => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01` }
const STATUS_TONE: Record<string, string> = { cancelled: 'text-bad', rejected: 'text-bad', closed: 'text-muted', converted: 'text-good', invoiced: 'text-good', received: 'text-good' }
const Status = ({ v }: { v: string }) => <span className={`capitalize ${STATUS_TONE[v] ?? ''}`}>{v.replaceAll('_', ' ')}</span>

interface Col<T> { head: string; cell: (r: T) => ReactNode; right?: boolean }
function DocTable<T>({ rows, cols, rowKey, onOpen, loading, hasMore, more, empty }: { rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; onOpen?: ((r: T) => void) | undefined; loading: boolean; hasMore?: boolean | undefined; more?: (() => void) | undefined; empty: string }) {
  if (loading) return <Spinner />
  if (rows.length === 0) return <p className="rounded-md border border-dashed border-line py-8 text-center text-sm text-muted">{empty}</p>
  return (
    <>
      <div className="-mx-4 overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead><tr className="border-y border-line bg-sunken text-left text-[11px] font-semibold uppercase tracking-wide text-muted">{cols.map((c, i) => <th key={c.head} className={`px-3 py-2 ${i === 0 ? 'pl-4' : ''} ${i === cols.length - 1 ? 'pr-4' : ''} ${c.right ? 'num text-right' : ''}`}>{c.head}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={`border-b border-line/70 last:border-b-0 ${onOpen ? 'cursor-pointer hover:bg-brand-soft/50' : 'hover:bg-sunken'}`} onClick={onOpen ? () => onOpen(r) : undefined}>
              {cols.map((c, i) => <td key={c.head} className={`px-3 py-2.5 ${i === 0 ? 'pl-4' : ''} ${i === cols.length - 1 ? 'pr-4' : ''} ${c.right ? 'num text-right tabular-nums' : ''}`}>{c.cell(r)}</td>)}
            </tr>))}
        </tbody>
      </table>
      </div>
      {hasMore ? <div className="pt-3"><Button variant="secondary" onClick={more}>Load more</Button></div> : null}
    </>
  )
}

function Stat({ label, value, tone, note }: { label: string; value: string; tone?: 'bad' | 'good'; note?: string | undefined }) {
  const bar = tone === 'bad' ? 'bg-bad' : tone === 'good' ? 'bg-good' : 'bg-line-strong'
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface px-4 pb-3 pt-3.5">
      <span className={`absolute inset-y-0 left-0 w-1 ${bar}`} aria-hidden />
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`num mt-1 text-[22px] font-semibold leading-tight tracking-tight ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-ink'}`}>{value}</p>
      {note ? <p className={`mt-1 text-xs ${tone === 'bad' ? 'font-medium text-bad' : 'text-muted'}`}>{note}</p> : null}
    </div>
  )
}

type Tab = 's-activity' | 's-invoices' | 's-receipts' | 's-quotes' | 's-orders' | 's-challans' | 'p-activity' | 'p-bills' | 'p-payments' | 'p-orders' | 'p-receipts'

/** One customer or supplier: what they owe or are owed, and every document with them, from the first quotation to the last payment. */
export function PartyDetailPage() {
  const { partyId } = useParams({ from: '/app/masterdata/parties/$partyId' })
  return <PartyDetail key={partyId} partyId={partyId} />
}

function PartyDetail({ partyId }: { partyId: string }) {
  const navigate = useNavigate()
  const ws = useWorkspace(); const companyId = ws.company?.id
  const perms = useSession((s) => s.me?.permissions ?? [])
  const q = useParty(partyId); const addresses = usePartyAddresses(partyId)
  const [editing, setEditing] = useState(false)
  const party = q.data
  const isCustomer = Boolean(party?.isCustomer); const isSupplier = Boolean(party?.isSupplier)
  const [tab, setTab] = useState<Tab | null>(null)
  const [from, setFrom] = useState(fyStart()); const [to, setTo] = useState(todayIso())
  const today = todayIso()
  const sellOn = isCustomer && can(perms, 'sales:read'); const buyOn = isSupplier && can(perms, 'purchasing:read')
  const active: Tab = tab ?? (sellOn ? 's-activity' : 'p-activity')

  const pos = usePosition(sellOn ? companyId : undefined, partyId, today); const spos = useSupplierPosition(buyOn ? companyId : undefined, partyId, today)
  const stmt = useStatement(sellOn && active === 's-activity' ? companyId : undefined, partyId, from, to); const sstmt = useSupplierStatement(buyOn && active === 'p-activity' ? companyId : undefined, partyId, from, to)
  const invoices = useInvoices({ companyId: sellOn && active === 's-invoices' ? companyId ?? '' : '', customerId: partyId })
  const receipts = useReceipts(sellOn && active === 's-receipts' ? companyId : undefined, partyId)
  const quotes = useQuotes(sellOn && active === 's-quotes' ? companyId : undefined, undefined, partyId)
  const orders = useOrders(sellOn && active === 's-orders' ? companyId : undefined, undefined, partyId)
  const challans = useChallans(sellOn && active === 's-challans' ? companyId : undefined, undefined, partyId)
  const bills = useBills({ companyId: buyOn && active === 'p-bills' ? companyId ?? '' : '', supplierId: partyId })
  const payments = usePayments(buyOn && active === 'p-payments' ? companyId : undefined, partyId)
  const pos2 = usePurchaseOrders({ companyId: buyOn && active === 'p-orders' ? companyId ?? '' : '', supplierId: partyId })
  const grns = useGoodsReceipts(buyOn && active === 'p-receipts' ? companyId : undefined, { supplierId: partyId })

  const tabs = useMemo(() => {
    const t: { id: Tab; label: string }[] = []
    const both = sellOn && buyOn
    if (sellOn) t.push({ id: 's-activity', label: both ? 'Sales ledger' : 'Ledger' }, { id: 's-invoices', label: 'Invoices & notes' }, { id: 's-receipts', label: 'Receipts' }, { id: 's-quotes', label: 'Quotes' }, { id: 's-orders', label: 'Sales orders' }, { id: 's-challans', label: 'Challans' })
    if (buyOn) t.push({ id: 'p-activity', label: both ? 'Purchase ledger' : 'Ledger' }, { id: 'p-bills', label: 'Bills & notes' }, { id: 'p-payments', label: 'Payments' }, { id: 'p-orders', label: 'Purchase orders' }, { id: 'p-receipts', label: 'Goods received' })
    return t
  }, [sellOn, buyOn])

  if (q.isPending) return <Spinner />
  if (q.error || !party) return <Alert>{q.error?.message ?? 'Not found.'}</Alert>
  const canWrite = can(perms, 'masterdata:write')
  const billing = (addresses.data ?? []).find((a) => a.kind === 'billing' && a.isDefault) ?? (addresses.data ?? []).find((a) => a.kind === 'billing') ?? addresses.data?.[0]
  const overdue = (pos.data?.openInvoices ?? []).filter((i) => i.daysOverdue > 0).reduce((s, i) => s + Number(i.outstanding), 0)
  const sOverdue = (spos.data?.openBills ?? []).filter((i) => i.daysOverdue > 0).reduce((s, i) => s + Number(i.outstanding), 0)
  const kindLabel = (k: string): string => k.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())

  const ledger = (s: { openingBalance: string; closingBalance: string; lines: { date: string; kind: string; number: string; debit: string; credit: string; balance: string }[] } | undefined, pending: boolean, owed: string) => (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted">From</span><input type="date" aria-label="From date" className="h-9 rounded-md border border-line bg-surface px-2" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold uppercase tracking-wide text-muted">To</span><input type="date" aria-label="To date" className="h-9 rounded-md border border-line bg-surface px-2" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {s ? (
          <div className="ml-auto flex items-stretch divide-x divide-line overflow-hidden rounded-md border border-line bg-sunken text-right">
            <p className="px-3 py-1.5"><span className="block text-[10.5px] font-semibold uppercase tracking-wide text-muted">Opening</span><span className="num font-medium">{formatInr(s.openingBalance)}</span></p>
            <p className="px-3 py-1.5"><span className="block text-[10.5px] font-semibold uppercase tracking-wide text-muted">Closing, {owed}</span><span className="num font-semibold text-ink">{formatInr(s.closingBalance)}</span></p>
          </div>) : null}
      </div>
      <DocTable loading={pending} rows={s?.lines ?? []} rowKey={(l) => `${l.date}${l.number}${l.kind}${l.balance}`} empty="Nothing in this period."
        cols={[{ head: 'Date', cell: (l) => formatDate(l.date) }, { head: 'Document', cell: (l) => <>{kindLabel(l.kind)} <span className="text-muted">{l.number}</span></> }, { head: 'Debit', right: true, cell: (l) => (Number(l.debit) ? formatInr(l.debit, { symbol: false }) : '') }, { head: 'Credit', right: true, cell: (l) => (Number(l.credit) ? formatInr(l.credit, { symbol: false }) : '') }, { head: 'Balance', right: true, cell: (l) => formatInr(l.balance, { symbol: false }) }]} />
    </>
  )

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 pb-6">
      <p className="text-xs text-muted"><Link to={isSupplier && !isCustomer ? '/masterdata/suppliers' : '/masterdata/customers'} className="hover:text-ink hover:underline">{isSupplier && !isCustomer ? 'Suppliers' : 'Customers'}</Link> <span aria-hidden>/</span> <span className="text-ink">{party.legalName}</span></p>
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-line bg-surface p-5">
        <div className="flex min-w-0 items-start gap-4">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-hero text-[20px] font-semibold text-white" aria-hidden>{party.legalName.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
          <div className="min-w-0">
            <h1 className="page-title !text-[22px]">{party.legalName}{party.tradeName ? <span className="ml-2 text-base font-normal text-muted">({party.tradeName})</span> : null}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span className="rounded bg-sunken px-2 py-0.5 font-mono text-muted">{party.code}</span>
              <span className="rounded bg-brand-soft px-2 py-0.5 font-medium text-brand">{roleLabel(party)}</span>
              <span className="rounded bg-sunken px-2 py-0.5 text-muted">{treatmentLabel(party.gstTreatment)}</span>
              {party.status !== 'active' ? <span className="rounded bg-bad-soft px-2 py-0.5 font-medium text-bad">{party.status === 'blocked' ? 'Blocked' : 'Inactive'}</span> : null}
            </div>
            <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-1 text-[13px] sm:grid-cols-2">
              {party.gstin ? <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted">GSTIN</dt><dd className="font-mono">{party.gstin}</dd></div> : null}
              {party.phone ? <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted">Phone</dt><dd>{party.phone}</dd></div> : null}
              {party.email ? <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted">Email</dt><dd className="truncate">{party.email}</dd></div> : null}
              {billing ? <div className="flex gap-2"><dt className="w-14 shrink-0 text-muted">Address</dt><dd>{[billing.line1, billing.line2, billing.city, billing.pincode].filter(Boolean).join(', ')}</dd></div> : null}
            </dl>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {sellOn && can(perms, 'sales:post') ? <Button onClick={() => void navigate({ to: '/sales/invoices/new', search: { customerId: partyId } as never })}>New invoice</Button> : null}
          {sellOn && can(perms, 'receivables:post') ? <Button variant="secondary" onClick={() => void navigate({ to: '/sales/receipts', search: { customerId: partyId } as never })}>Record receipt</Button> : null}
          {buyOn && can(perms, 'purchasing:post') ? <Button onClick={() => void navigate({ to: '/purchasing/bills/new', search: { supplierId: partyId } })}>New bill</Button> : null}
          {buyOn && can(perms, 'payables:post') ? <Button variant="secondary" onClick={() => void navigate({ to: '/purchasing/payments', search: { supplierId: partyId } })}>Pay supplier</Button> : null}
          {canWrite ? <Button variant="secondary" onClick={() => setEditing(true)}>Edit details</Button> : null}
        </div>
      </header>

      {sellOn || buyOn ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {sellOn ? <>
            <Stat label="They owe you" value={formatInr(pos.data?.totalOutstanding ?? '0')} {...(overdue > 0 ? { tone: 'bad' as const, note: `${formatInr(String(overdue))} overdue` } : {})} />
            <Stat label="Unapplied receipts and credits" value={formatInr(pos.data?.totalUnapplied ?? '0')} />
            <Stat label="Net balance" value={formatInr(pos.data?.balance ?? '0')} note="Positive: they owe you" />
            <Stat label="Credit limit" value={pos.data?.customer.creditLimit && Number(pos.data.customer.creditLimit) ? formatInr(pos.data.customer.creditLimit) : 'None set'} {...(pos.data?.creditLimitExceeded ? { tone: 'bad' as const, note: 'Limit exceeded' } : {})} />
          </> : null}
          {buyOn ? <>
            <Stat label="You owe them" value={formatInr(spos.data?.totalOutstanding ?? '0')} {...(sOverdue > 0 ? { tone: 'bad' as const, note: `${formatInr(String(sOverdue))} overdue` } : {})} />
            <Stat label="Unapplied payments and credits" value={formatInr(spos.data?.totalUnapplied ?? '0')} />
            <Stat label="Net payable" value={formatInr(spos.data?.balance ?? '0')} />
          </> : null}
        </div>
      ) : null}
      {!sellOn && !buyOn ? <Alert tone="info">This is a party with no customer or supplier role you can see documents for. Use Edit details to change its role.</Alert> : null}

      {tabs.length > 0 ? (
        <Card>
          <div role="tablist" className="-mx-4 mb-4 flex flex-wrap gap-1 border-b border-line px-4">
            {tabs.map((t) => <button key={t.id} role="tab" aria-selected={active === t.id} onClick={() => setTab(t.id)} className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] ${active === t.id ? 'border-brand font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'}`}>{t.label}</button>)}
          </div>
          {active === 's-activity' ? ledger(stmt.data, stmt.isPending, 'owed to you') : null}
          {active === 'p-activity' ? ledger(sstmt.data, sstmt.isPending, 'owed by you') : null}
          {active === 's-invoices' ? <DocTable loading={invoices.isPending && Boolean(companyId)} rows={invoices.rows} rowKey={(r) => r.id} hasMore={Boolean(invoices.hasNextPage)} more={() => void invoices.fetchNextPage()} empty="No invoices yet." onOpen={(r) => void navigate({ to: '/sales/invoices/$invoiceId', params: { invoiceId: r.id } })}
            cols={[{ head: 'Number', cell: (r) => <span className="font-medium">{r.invoiceNo}</span> }, { head: 'Type', cell: (r) => DOC_LABEL[r.documentType] ?? r.documentType }, { head: 'Date', cell: (r) => formatDate(r.invoiceDate) }, { head: 'Due', cell: (r) => formatDate(r.dueDate) }, { head: 'Total', right: true, cell: (r) => formatInr(r.grandTotal) }, { head: 'Status', cell: (r) => <Status v={r.status} /> }]} /> : null}
          {active === 's-receipts' ? <DocTable loading={receipts.isPending} rows={receipts.data ?? []} rowKey={(r) => r.id} empty="No receipts yet."
            cols={[{ head: 'Number', cell: (r) => <span className="font-medium">{r.receiptNo}</span> }, { head: 'Date', cell: (r) => formatDate(r.receiptDate) }, { head: 'Method', cell: (r) => <span className="capitalize">{r.method}</span> }, { head: 'Reference', cell: (r) => r.reference ?? '' }, { head: 'Amount', right: true, cell: (r) => formatInr(r.amount) }, { head: 'Status', cell: (r) => <Status v={r.status} /> }]} /> : null}
          {active === 's-quotes' ? <DocTable loading={quotes.isPending && Boolean(companyId)} rows={quotes.rows} rowKey={(r) => r.id} hasMore={Boolean(quotes.hasNextPage)} more={() => void quotes.fetchNextPage()} empty="No quotations."
            cols={[{ head: 'Number', cell: (r) => <span className="font-medium">{r.quoteNo}</span> }, { head: 'Date', cell: (r) => formatDate(r.quoteDate) }, { head: 'Valid until', cell: (r) => formatDate(r.validUntil) }, { head: 'Estimate', right: true, cell: (r) => formatInr(r.estimatedTotal) }, { head: 'Status', cell: (r) => <Status v={r.status} /> }]} /> : null}
          {active === 's-orders' ? <DocTable loading={orders.isPending && Boolean(companyId)} rows={orders.rows} rowKey={(r) => r.id} hasMore={Boolean(orders.hasNextPage)} more={() => void orders.fetchNextPage()} empty="No sales orders."
            cols={[{ head: 'Number', cell: (r) => <span className="font-medium">{r.orderNo}</span> }, { head: 'Date', cell: (r) => formatDate(r.orderDate) }, { head: 'Their reference', cell: (r) => r.customerReference ?? '' }, { head: 'Status', cell: (r) => <Status v={r.status} /> }]} /> : null}
          {active === 's-challans' ? <DocTable loading={challans.isPending && Boolean(companyId)} rows={challans.rows} rowKey={(r) => r.id} hasMore={Boolean(challans.hasNextPage)} more={() => void challans.fetchNextPage()} empty="No delivery challans."
            cols={[{ head: 'Number', cell: (r) => <span className="font-medium">{r.orderNo}</span> }, { head: 'Date', cell: (r) => formatDate(r.orderDate) }, { head: 'Vehicle', cell: (r) => r.vehicleNo ?? '' }, { head: 'Status', cell: (r) => <Status v={r.status} /> }]} /> : null}
          {active === 'p-bills' ? <DocTable loading={bills.isPending && Boolean(companyId)} rows={bills.rows} rowKey={(r) => r.id} hasMore={Boolean(bills.hasNextPage)} more={() => void bills.fetchNextPage()} empty="No bills yet." onOpen={(r) => void navigate({ to: '/purchasing/bills/$billId', params: { billId: r.id } })}
            cols={[{ head: 'Number', cell: (r) => <span className="font-medium">{r.billNo}</span> }, { head: 'Their invoice', cell: (r) => r.supplierInvoiceNo }, { head: 'Date', cell: (r) => formatDate(r.billDate) }, { head: 'Due', cell: (r) => formatDate(r.dueDate) }, { head: 'Total', right: true, cell: (r) => formatInr(r.grandTotal) }, { head: 'Status', cell: (r) => <Status v={r.status} /> }]} /> : null}
          {active === 'p-payments' ? <DocTable loading={payments.isPending && Boolean(companyId)} rows={payments.rows} rowKey={(r) => r.id} hasMore={Boolean(payments.hasNextPage)} more={() => void payments.fetchNextPage()} empty="No payments yet."
            cols={[{ head: 'Number', cell: (r) => <span className="font-medium">{r.paymentNo}</span> }, { head: 'Date', cell: (r) => formatDate(r.paymentDate) }, { head: 'Method', cell: (r) => <span className="capitalize">{r.method}</span> }, { head: 'Reference', cell: (r) => r.reference ?? '' }, { head: 'Amount', right: true, cell: (r) => formatInr(r.amount) }, { head: 'Status', cell: (r) => <Status v={r.status} /> }]} /> : null}
          {active === 'p-orders' ? <DocTable loading={pos2.isPending && Boolean(companyId)} rows={pos2.rows} rowKey={(r) => r.id} hasMore={Boolean(pos2.hasNextPage)} more={() => void pos2.fetchNextPage()} empty="No purchase orders." onOpen={(r) => void navigate({ to: '/purchasing/orders/$orderId', params: { orderId: r.id } })}
            cols={[{ head: 'Number', cell: (r) => <span className="font-medium">{r.poNo}</span> }, { head: 'Date', cell: (r) => formatDate(r.orderDate) }, { head: 'Expected', cell: (r) => formatDate(r.expectedDate) }, { head: 'Status', cell: (r) => <Status v={r.status} /> }]} /> : null}
          {active === 'p-receipts' ? <DocTable loading={grns.isPending && Boolean(companyId)} rows={grns.rows} rowKey={(r) => r.id} hasMore={Boolean(grns.hasNextPage)} more={() => void grns.fetchNextPage()} empty="No goods received."
            cols={[{ head: 'Number', cell: (r) => <span className="font-medium">{r.grnNo}</span> }, { head: 'Date', cell: (r) => formatDate(r.receiptDate) }, { head: 'Their delivery note', cell: (r) => r.supplierDeliveryNote ?? '' }, { head: 'Status', cell: (r) => <Status v={r.status} /> }]} /> : null}
        </Card>
      ) : null}

      <Card><AttachmentsPanel entityType="party" entityId={partyId} canWrite={canWrite} /></Card>
      {editing ? <Drawer title={party.legalName} onClose={() => setEditing(false)} width={580}><PartyForm party={party} canWrite={canWrite} onDone={() => setEditing(false)} /></Drawer> : null}
    </div>
  )
}
