import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { OrderHeader } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate } from '@/domain/format'
import { usePartiesById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Alert, Button, SelectField, Spinner, Toolbar } from '@/ui/primitives'
import { OrderDetail } from './QuotesOrdersPages'
import { useChallans } from './orderQueries'

const STATUS: Record<string, string> = { open: 'Not invoiced', partially_invoiced: 'Partly invoiced', invoiced: 'Invoiced', closed: 'Closed', cancelled: 'Cancelled' }

/** Goods sent to customers that have not been (fully) invoiced yet. Invoicing a challan posts the sale; the challan itself posts nothing. */
export function ChallansPage() {
  const ws = useWorkspace(); const navigate = useNavigate()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'sales:post')
  const [status, setStatus] = useState('')
  const list = useChallans(ws.company?.id, status || undefined)
  const customers = usePartiesById(list.rows.map((o) => o.customerId))
  const [open, setOpen] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<OrderHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'orderNo', size: 160 }, { header: 'Customer', accessorFn: (o) => customers.data?.get(o.customerId)?.legalName ?? '', size: 260 }, { header: 'Date', accessorFn: (o) => formatDate(o.orderDate), size: 100 },
    { header: 'Vehicle', accessorFn: (o) => o.vehicleNo ?? '', size: 120 }, { header: 'Their reference', accessorFn: (o) => o.customerReference ?? '', size: 150 }, { header: 'Status', accessorFn: (o) => STATUS[o.status] ?? o.status, size: 130 },
  ], [customers.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Delivery challans</h1>{canPost ? <Button onClick={() => void navigate({ to: '/sales/challans/new' })}><Plus className="size-4" aria-hidden /> New delivery challan</Button> : null}</div>
      <p className="text-sm text-muted">A challan records goods sent to a customer before the invoice. Stock leaves and tax is charged when you invoice it.</p>
      <Toolbar><div className="w-48"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, ...Object.entries(STATUS).map(([value, label]) => ({ value, label }))]} /></div></Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(o) => o.id} onOpen={(o) => setOpen(o.id)} empty="No delivery challans yet." height={480} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
      {open ? <OrderDetail id={open} challan onClose={() => setOpen(null)} /> : null}
    </div>
  )
}
