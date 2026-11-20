import { useNavigate } from '@tanstack/react-router'
import { Download, ShoppingCart } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import { item as itemSchema } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { currentApi, useSession } from '@/auth/session'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { setPoDraft } from '@/features/purchasing/poDraft'
import { emptyLine, type Line } from '@/features/sales/LineGrid'
import { Alert, Button, Spinner } from '@/ui/primitives'
import { useLowStock } from './queries'

/** Items that have fallen to their reorder level, with a suggested quantity; one click turns the ticked ones into a purchase order. */
export function LowStockPage() {
  const ws = useWorkspace(); const navigate = useNavigate()
  const canBuy = can(useSession((s) => s.me?.permissions ?? []), 'purchasing:write')
  const r = useLowStock(ws.company?.id)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false); const [problem, setProblem] = useState<string | null>(null)
  const rows = useMemo(() => r.data?.rows ?? [], [r.data])
  const picked = rows.filter((x) => !off.has(x.itemId) && Number(x.suggestedQty) > 0)

  async function makeOrder() {
    setBusy(true); setProblem(null)
    try {
      const api = currentApi()
      const lines: Line[] = []
      for (const x of picked) {
        const it = await api.call(api.raw.GET('/v1/items/{id}', { params: { path: { id: x.itemId } } }), itemSchema)
        lines.push({ ...emptyLine(), item: it, description: it.name, quantity: String(Number(x.suggestedQty)), unitPrice: x.lastCost ? String(Number(x.lastCost)) : '' })
      }
      setPoDraft(lines); await navigate({ to: '/purchasing/orders/new' })
    } catch (e) { setProblem(e instanceof ApiError ? e.message : 'Could not start the order.') } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Reorder list</h1>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={!rows.length} onClick={() => download('reorder-list.csv', toCsv(['Code', 'Name', 'On hand', 'Reorder level', 'On order', 'Suggested quantity'], rows.map((x) => [x.code, x.name, x.onHand, x.reorderLevel, x.onOrder, x.suggestedQty])))}><Download className="size-4" aria-hidden /> Export CSV</Button>
          {canBuy ? <Button busy={busy} disabled={picked.length === 0} onClick={() => void makeOrder()}><ShoppingCart className="size-4" aria-hidden /> Create purchase order ({picked.length})</Button> : null}
        </div></div>
      <p className="text-sm text-muted">Items at or below the reorder level you set on the item. Quantities already on open purchase orders are taken off the suggestion.</p>
      {problem ? <Alert>{problem}</Alert> : null}
      {r.error ? <Alert>{r.error instanceof ApiError ? r.error.message : 'Could not load the list.'}</Alert> : null}
      {r.isPending ? <Spinner /> : (
        <div className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm" aria-label="Reorder list">
            <thead className="sticky top-0 bg-sunken text-left"><tr><th className="w-10 px-3 py-2"><span className="sr-only">Include</span></th><th className="px-2 py-2">Code</th><th className="px-2 py-2">Name</th>{['On hand', 'Reorder level', 'On order', 'Suggested'].map((h) => <th key={h} className="px-2 py-2 text-right">{h}</th>)}</tr></thead>
            <tbody>{rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center text-muted">Nothing needs reordering. Set a reorder level on an item to be told when it runs low.</td></tr> : rows.map((x) => (
              <tr key={x.itemId} className="border-t border-line"><td className="px-3 py-1.5"><input type="checkbox" aria-label={`Include ${x.name}`} disabled={Number(x.suggestedQty) <= 0} checked={!off.has(x.itemId) && Number(x.suggestedQty) > 0} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(x.itemId)) n.delete(x.itemId); else n.add(x.itemId); return n })} /></td>
                <td className="px-2 py-1.5">{x.code}</td><td className="px-2 py-1.5">{x.name}</td><td className="px-2 py-1.5 text-right">{Number(x.onHand)}</td><td className="px-2 py-1.5 text-right">{Number(x.reorderLevel)}</td><td className="px-2 py-1.5 text-right">{Number(x.onOrder)}</td><td className="px-2 py-1.5 text-right font-medium">{Number(x.suggestedQty)}</td></tr>))}</tbody>
          </table>
        </div>)}
    </div>
  )
}
