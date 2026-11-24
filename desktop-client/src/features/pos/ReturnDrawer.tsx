import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { ApiError, NetworkError } from '@/api/errors'
import type { PosShift } from '@/api/schemas'
import { POS_METHODS } from '@/api/schemas'
import { bridge } from '@/bridge'
import { giftCardHtml } from './giftCardHtml'
import { lookupGiftCard } from './queries'
import { formatDate, formatInr } from '@/domain/format'
import { fromUnits, isValid, toUnits } from '@/domain/money'
import { showQty } from '@/domain/quantity'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { Alert, Button, SelectField, Spinner, TextField } from '@/ui/primitives'
import { postReturn, useSaleDetail, useSales } from './queries'

const METHOD: Record<string, string> = { gift_card: 'Gift card (new card for the customer)', store_credit: 'Store credit (kept for the customer)', cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' }
/** The credit note total as the server rounds it: the returned share of each line, then the nearest rupee (half up). */
function estimate(lines: { lineTotal: string; quantity: string }[], qty: number[]): string {
  let total = 0n
  lines.forEach((l, i) => { const q = qty[i] ?? 0; if (q > 0) total += (toUnits(l.lineTotal) * BigInt(Math.round(q * 1_000_000))) / BigInt(Math.round(Number(l.quantity) * 1_000_000)) })
  return fromUnits(((total + 5_000n) / 10_000n) * 10_000n)
}

export function ReturnDrawer({ shift, onClose }: { shift: PosShift; onClose: () => void }) {
  const ws = useWorkspace()
  const flash = useFlash()
  const qc = useQueryClient()
  const sales = useSales(ws.company?.id, undefined, 'sale')
  const [filter, setFilter] = useState('')
  const [saleId, setSaleId] = useState<string | undefined>()
  const detail = useSaleDetail(saleId)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState('cash')
  const [refund, setRefund] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const doc = detail.data?.document
  const picked = useMemo(() => (doc ? doc.lines.map((l) => Number(qty[l.id] ?? 0) || 0) : []), [doc, qty])
  const est = doc ? estimate(doc.lines, picked) : '0'
  const key = useMemo(() => crypto.randomUUID(), [saleId, JSON.stringify(qty), reason, method, refund]) // eslint-disable-line react-hooks/exhaustive-deps
  const list = (sales.data ?? []).filter((s) => !filter || s.documentNo.toLowerCase().includes(filter.toLowerCase()))
  async function submit() {
    if (!doc || !saleId) return
    const lines = doc.lines.filter((l) => Number(qty[l.id] ?? 0) > 0).map((l) => ({ originalLineId: l.id, quantity: qty[l.id] as string }))
    if (!lines.length) { setProblem('Choose what is being returned.'); return }
    setBusy(true); setProblem(null)
    try {
      const r = await postReturn({ shiftId: shift.id, originalSaleId: saleId, reason: reason.trim(), lines, refunds: [{ method, amount: refund || est }] }, key)
      void qc.invalidateQueries({ queryKey: ['retail'] })
      if (method === 'gift_card') {
        // the refund became a new card: hand the customer its slip
        const code = r.payments.find((p) => p.method === 'gift_card')?.reference
        if (code && ws.company) { try { await bridge.document.savePdf(giftCardHtml(await lookupGiftCard(ws.company.id, code), ws.company.legalName), `gift-card-${code}`) } catch { /* the code is in the message below */ } }
        flash.show(`${r.creditNote?.invoiceNo ?? 'Return'} recorded. ${formatInr(r.creditNote?.grandTotal ?? '0')} put on gift card ${code ?? ''}.`); onClose(); return
      }
      flash.show(method === 'store_credit' ? `${r.creditNote?.invoiceNo ?? 'Return'} recorded. ${formatInr(r.creditNote?.grandTotal ?? '0')} kept as store credit.` : `${r.creditNote?.invoiceNo ?? 'Return'} recorded. Refund ${formatInr(r.creditNote?.grandTotal ?? '0')}.`); onClose()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'payment_mismatch' && typeof e.extra['total'] === 'string') { setRefund(e.extra['total']); setProblem(`The refund must equal the credit note total, ${formatInr(e.extra['total'])}. It has been corrected: check it and press the button again.`) }
      else setProblem(e instanceof NetworkError ? 'No connection. Returns need the server: try again when it is back.' : e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : 'The return was not recorded.')
    } finally { setBusy(false) }
  }
  return (
    <Drawer title="Return goods" onClose={onClose} width={620}>
      <div className="flex flex-col gap-4">
        {!saleId ? (
          <>
            <TextField label="Find the sale by receipt number" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
            {sales.isPending ? <Spinner /> : list.length === 0 ? <Alert tone="info">No matching sale.</Alert> : (
              <ul className="flex flex-col gap-1" aria-label="Sales">{list.slice(0, 30).map((s) => <li key={s.id}><button type="button" className="flex w-full justify-between rounded border border-line px-3 py-2 text-left text-sm hover:bg-canvas" onClick={() => setSaleId(s.id)}><span>{s.documentNo}</span><span className="text-muted">{formatDate(s.createdAt.slice(0, 10))} · {formatInr(s.total)}</span></button></li>)}</ul>)}
          </>
        ) : detail.isPending ? <Spinner /> : !doc ? <Alert>{detail.error?.message ?? 'Sale not found.'}</Alert> : (
          <>
            <p className="text-sm text-muted">{doc.invoiceNo} · {formatDate(doc.invoiceDate)} · {formatInr(doc.grandTotal)} <button type="button" className="ml-2 underline" onClick={() => { setSaleId(undefined); setQty({}) }}>choose another</button></p>
            <table className="w-full text-sm" aria-label="Sold lines"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Item</th><th className="py-1 text-right">Sold</th><th className="py-1 text-right">Amount</th><th className="w-24 py-1 text-right">Return</th></tr></thead>
              <tbody>{doc.lines.map((l) => <tr key={l.id} className="border-t border-line/60"><td className="py-1.5">{l.description}</td><td className="num py-1.5 text-right">{showQty(l.quantity)}</td><td className="num py-1.5 text-right">{formatInr(l.lineTotal, { symbol: false })}</td>
                <td className="py-1"><input aria-label={`Return ${l.description}`} inputMode="decimal" className="h-8 w-full rounded border border-line bg-surface px-2 text-right text-sm" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td></tr>)}</tbody></table>
            <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="grid grid-cols-2 gap-4"><SelectField label="Refund by" value={method} onChange={(e) => setMethod(e.target.value)} options={[...POS_METHODS, 'store_credit', 'gift_card'].map((m) => ({ value: m, label: METHOD[m] ?? m }))} /><TextField label="Refund amount" inputMode="decimal" value={refund !== '' ? refund : est === '0' ? '' : est} onChange={(e) => setRefund(e.target.value)} hint="Worked out from what is returned" /></div>
            {problem ? <Alert>{problem}</Alert> : null}
            <Button busy={busy} disabled={!reason.trim() || Number(est) <= 0 || !isValid(refund || est)} onClick={() => void submit()}>Record return and refund</Button>
          </>
        )}
        {problem && !doc ? <Alert>{problem}</Alert> : null}
      </div>
    </Drawer>
  )
}
