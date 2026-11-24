import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ApiError } from '@/api/errors'
import type { OrderHeader, QuoteHeader } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { showQty, subQty } from '@/domain/quantity'
import { useItemsById, usePartiesById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, CheckField, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { usePartyAddresses } from '@/features/masterdata/queries'
import { printSalesDoc, type DocSource, type PrintKind } from './salesDocPrint'
import { useSeller } from './useSeller'
import { useConvertQuote, useInvoiceOrder, useOrder, useOrderAction, useOrders, useQuote, useQuotes, useRejectQuote } from './orderQueries'

const QSTATUS: Record<string, string> = { open: 'Open', rejected: 'Rejected', converted: 'Became an order' }
const OSTATUS: Record<string, string> = { open: 'Open', partially_invoiced: 'Partly invoiced', invoiced: 'Invoiced', closed: 'Closed', cancelled: 'Cancelled' }
const msg = (e: unknown, f: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : f)


/** Print buttons for a quotation, a sales order or the proforma invoice made from either. Needs the right to post sales: the figures come from the server's pricing. */
function PrintBar({ kinds, source }: { kinds: { kind: PrintKind; label: string }[]; source: DocSource | null }) {
  const perms = useSession((s) => s.me?.permissions ?? [])
  const seller = useSeller(source?.gstRegistrationId)
  const addresses = usePartyAddresses(source?.customerId)
  const billTo = (addresses.data ?? []).find((a) => a.kind === 'billing' && a.isDefault) ?? (addresses.data ?? []).find((a) => a.kind === 'billing')
  const [busy, setBusy] = useState<PrintKind | null>(null); const [problem, setProblem] = useState<string | null>(null)
  if (!source || !can(perms, 'sales:post')) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">{kinds.map((k) => (
        <Button key={k.kind} variant="secondary" busy={busy === k.kind} disabled={!seller} onClick={async () => { setProblem(null); setBusy(k.kind); try { await printSalesDoc(k.kind, source, seller as NonNullable<typeof seller>, billTo) } catch (e) { setProblem(msg(e, 'Could not make the document.')) } finally { setBusy(null) } }}>{window.onesync ? `${k.label} (PDF)` : k.label}</Button>))}</div>
      {problem ? <Alert>{problem}</Alert> : null}
    </div>
  )
}

function QuoteDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace()
  const q = useQuote(id)
  const quote = q.data
  const perms = useSession((s) => s.me?.permissions ?? [])
  const items = useItemsById(quote?.lines.map((l) => l.itemId) ?? [])
  const customers = usePartiesById(quote ? [quote.customerId] : [])
  const convert = useConvertQuote(); const reject = useRejectQuote()
  const flash = useFlash()
  const navigate = useNavigate()
  const [date, setDate] = useState(todayIso())
  const [reserve, setReserve] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  return (
    <Drawer title={quote?.quoteNo ?? 'Quote'} onClose={onClose} width={680}>
      {q.isPending ? <Spinner /> : !quote ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{customers.data?.get(quote.customerId)?.legalName ?? ''} · {formatDate(quote.quoteDate)} · valid until {formatDate(quote.validUntil)} · {QSTATUS[quote.status] ?? quote.status}</p>
          <table className="w-full text-sm" aria-label="Quote lines"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Price</th><th className="py-1 text-right">Estimated total</th></tr></thead>
            <tbody>{quote.lines.map((l) => <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{items.data?.get(l.itemId)?.code ?? ''} {l.description ?? ''}</td><td className="num py-1.5 text-right">{showQty(l.quantity)}</td><td className="num py-1.5 text-right">{formatInr(l.unitPrice, { symbol: false })}</td><td className="num py-1.5 text-right">{formatInr(l.estimatedTotal, { symbol: false })}</td></tr>)}
              <tr className="border-t border-line font-semibold"><td className="py-1.5" colSpan={3}>Estimated total (tax {formatInr(quote.estimatedTax)})</td><td className="num py-1.5 text-right">{formatInr(quote.estimatedTotal)}</td></tr></tbody></table>
          {quote.notes ? <p className="text-sm">{quote.notes}</p> : null}
          <PrintBar kinds={[{ kind: 'quotation', label: 'Print quotation' }, { kind: 'proforma', label: 'Print proforma invoice' }]} source={{ no: quote.quoteNo, date: quote.quoteDate, companyId: ws.company?.id ?? '', gstRegistrationId: quote.gstRegistrationId, customerId: quote.customerId, validUntil: quote.validUntil, notes: quote.notes, lines: quote.lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: false })) }} />
          <p className="text-xs text-muted">A quote is an offer, not a posting: nothing reaches the books or the stock until it becomes an order and is invoiced. Tax and total are estimates until then.</p>
          {problem ? <Alert>{problem}</Alert> : null}
          {quote.status === 'open' && can(perms, 'sales:post') ? (
            <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
              <div className="flex items-end gap-4"><div className="w-44"><TextField label="Order date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div><CheckField label="Hold the stock" checked={reserve} onChange={(e) => setReserve(e.target.checked)} /></div>
              <div className="flex gap-2"><Button busy={convert.isPending} onClick={async () => { setProblem(null); try { const o = await convert.mutateAsync({ id: quote.id, key: crypto.randomUUID(), body: { orderDate: date, reserveStock: reserve } }); flash.show(`${o.orderNo} created from ${quote.quoteNo}.`); onClose(); await navigate({ to: '/sales/orders' }) } catch (e) { setProblem(msg(e, 'Could not create the order.')) } }}>Make it a sales order</Button>
                <Button variant="ghost" busy={reject.isPending} onClick={async () => { try { await reject.mutateAsync(quote.id); flash.show(`${quote.quoteNo} marked as rejected.`); onClose() } catch (e) { setProblem(msg(e, 'Could not reject.')) } }}>Customer declined</Button></div>
            </div>) : null}
        </div>)}
    </Drawer>
  )
}

export function QuotesPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'sales:post')
  const [status, setStatus] = useState('open')
  const list = useQuotes(ws.company?.id, status || undefined)
  const customers = usePartiesById(list.rows.map((q) => q.customerId))
  const [open, setOpen] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<QuoteHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'quoteNo', size: 150 }, { header: 'Customer', accessorFn: (q) => customers.data?.get(q.customerId)?.legalName ?? '', size: 260 }, { header: 'Date', accessorFn: (q) => formatDate(q.quoteDate), size: 100 },
    { header: 'Valid until', accessorFn: (q) => formatDate(q.validUntil), size: 110 }, { header: 'Estimate', accessorFn: (q) => formatInr(q.estimatedTotal), size: 130, meta: { align: 'right' } }, { header: 'Status', accessorFn: (q) => QSTATUS[q.status] ?? q.status, size: 130 },
  ], [customers.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Quotes</h1>{canPost ? <Button onClick={() => void navigate({ to: '/sales/quotes/new' })}><Plus className="size-4" aria-hidden /> New quote</Button> : null}</div>
      <Toolbar><div className="w-44"><SelectField label="Show" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'open', label: 'Open' }, { value: 'converted', label: 'Became an order' }, { value: 'rejected', label: 'Rejected' }, { value: '', label: 'All' }]} /></div></Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(q) => q.id} onOpen={(q) => setOpen(q.id)} empty="No quotes yet." height={480} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {open ? <QuoteDetail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

function OrderDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const ws = useWorkspace()
  const q = useOrder(id)
  const order = q.data
  const perms = useSession((s) => s.me?.permissions ?? [])
  const items = useItemsById(order?.lines.map((l) => l.itemId) ?? [])
  const customers = usePartiesById(order ? [order.customerId] : [])
  const invoice = useInvoiceOrder(); const action = useOrderAction()
  const flash = useFlash()
  const navigate = useNavigate()
  const [date, setDate] = useState(todayIso())
  const [qty, setQty] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const left = (l: { quantity: string; quantityInvoiced: string }): string => subQty(l.quantity, l.quantityInvoiced)
  const live = order?.status === 'open' || order?.status === 'partially_invoiced'
  return (
    <Drawer title={order?.orderNo ?? 'Sales order'} onClose={onClose} width={720}>
      {q.isPending ? <Spinner /> : !order ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{customers.data?.get(order.customerId)?.legalName ?? ''} · {formatDate(order.orderDate)}{order.customerReference ? ` · your ref ${order.customerReference}` : ''} · {OSTATUS[order.status] ?? order.status}{order.reserveStock ? ' · stock held' : ''}</p>
          <table className="w-full text-sm" aria-label="Order lines"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="py-1 text-right">Ordered</th><th className="py-1 text-right">Invoiced</th><th className="py-1 text-right">Price</th>{live ? <th className="w-28 py-1 text-right">Invoice now</th> : null}</tr></thead>
            <tbody>{order.lines.map((l) => <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{items.data?.get(l.itemId)?.code ?? ''} {l.description ?? ''}</td><td className="num py-1.5 text-right">{showQty(l.quantity)}</td><td className="num py-1.5 text-right">{showQty(l.quantityInvoiced)}</td><td className="num py-1.5 text-right">{formatInr(l.unitPrice, { symbol: false })}</td>
              {live ? <td className="py-1"><input aria-label={`Invoice ${items.data?.get(l.itemId)?.code ?? l.lineNo}`} inputMode="decimal" className="h-8 w-full rounded border border-line bg-surface px-2 text-right text-sm" placeholder={showQty(left(l))} value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td> : null}</tr>)}</tbody></table>
          <PrintBar kinds={[{ kind: 'order', label: 'Print order' }, { kind: 'proforma', label: 'Print proforma invoice' }]} source={{ no: order.orderNo, date: order.orderDate, companyId: ws.company?.id ?? '', gstRegistrationId: order.gstRegistrationId, customerId: order.customerId, reference: order.customerReference, lines: order.lines.map((l) => ({ itemId: l.itemId, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxInclusive: l.taxInclusive })) }} />
          {order.invoices?.length ? <p className="text-sm">Invoices: {order.invoices.map((i) => `${i.invoiceNo} (${formatInr(i.grandTotal)})`).join(', ')}</p> : null}
          {problem ? <Alert>{problem}</Alert> : null}
          {live && can(perms, 'sales:post') ? (
            <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
              <div className="w-44"><TextField label="Invoice date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <p className="text-xs text-muted">Leave the quantities empty to invoice everything still outstanding, or enter what is being delivered now.</p>
              <div className="flex gap-2">
                <Button busy={invoice.isPending} onClick={async () => {
                  setProblem(null)
                  const lines = order.lines.filter((l) => Number(qty[l.id] ?? 0) > 0).map((l) => ({ orderLineId: l.id, quantity: qty[l.id] as string }))
                  try { const inv = await invoice.mutateAsync({ id: order.id, key: crypto.randomUUID(), body: { invoiceDate: date, ...(lines.length ? { lines } : {}) } }); flash.show(`${inv.invoiceNo} posted from ${order.orderNo}.`); onClose(); await navigate({ to: '/sales/invoices/$invoiceId', params: { invoiceId: inv.id } }) } catch (e) { setProblem(msg(e, 'Could not invoice the order.')) }
                }}>Invoice</Button>
                <Button variant="ghost" onClick={async () => { try { await action.mutateAsync({ id: order.id, action: 'close' }); flash.show(`${order.orderNo} closed: nothing more will be invoiced.`); onClose() } catch (e) { setProblem(msg(e, 'Could not close.')) } }}>Close order</Button>
                {order.status === 'open' ? <Button variant="ghost" onClick={async () => { try { await action.mutateAsync({ id: order.id, action: 'cancel' }); flash.show(`${order.orderNo} cancelled and any held stock released.`); onClose() } catch (e) { setProblem(msg(e, 'Could not cancel.')) } }}>Cancel order</Button> : null}
              </div>
            </div>) : null}
        </div>)}
    </Drawer>
  )
}

export function OrdersPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'sales:post')
  const [status, setStatus] = useState('')
  const list = useOrders(ws.company?.id, status || undefined)
  const customers = usePartiesById(list.rows.map((o) => o.customerId))
  const [open, setOpen] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<OrderHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'orderNo', size: 160 }, { header: 'Customer', accessorFn: (o) => customers.data?.get(o.customerId)?.legalName ?? '', size: 260 }, { header: 'Date', accessorFn: (o) => formatDate(o.orderDate), size: 100 },
    { header: 'Their reference', accessorFn: (o) => o.customerReference ?? '', size: 150 }, { header: 'Stock held', accessorFn: (o) => (o.reserveStock ? 'Yes' : ''), size: 90 }, { header: 'Status', accessorFn: (o) => OSTATUS[o.status] ?? o.status, size: 130 },
  ], [customers.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Sales orders</h1>{canPost ? <Button onClick={() => void navigate({ to: '/sales/orders/new' })}><Plus className="size-4" aria-hidden /> New sales order</Button> : null}</div>
      <Toolbar><div className="w-48"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, ...Object.entries(OSTATUS).map(([value, label]) => ({ value, label }))]} /></div></Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(o) => o.id} onOpen={(o) => setOpen(o.id)} empty="No sales orders yet." height={480} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {open ? <OrderDetail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}
