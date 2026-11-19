import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { PurchaseOrderHeader } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate } from '@/domain/format'
import { usePartiesById } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Alert, Button, SelectField, Spinner, Toolbar } from '@/ui/primitives'
import { usePurchaseOrders } from './queries'

export const ORDER_STATUS: Record<string, string> = { open: 'Open', partially_received: 'Partly received', received: 'Received', closed: 'Closed', cancelled: 'Cancelled' }

export function PurchaseOrdersPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'purchasing:post')
  const [status, setStatus] = useState('')
  const list = usePurchaseOrders({ companyId: ws.company?.id ?? '', ...(status ? { status } : {}) })
  const names = usePartiesById(list.rows.map((o) => o.supplierId))
  const columns = useMemo<ColumnDef<PurchaseOrderHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'poNo', size: 150 },
    { header: 'Date', accessorFn: (o) => formatDate(o.orderDate), size: 100 },
    { header: 'Supplier', accessorFn: (o) => names.data?.get(o.supplierId)?.legalName ?? '…', size: 280 },
    { header: 'Expected', accessorFn: (o) => (o.expectedDate ? formatDate(o.expectedDate) : ''), size: 100 },
    { header: 'Status', accessorFn: (o) => ORDER_STATUS[o.status] ?? o.status, size: 140 },
  ], [names.data])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">No company yet. <Link to="/setup" className="underline">Set up your business</Link>.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="page-title">Purchase orders</h1>{canPost ? <Button onClick={() => void navigate({ to: '/purchasing/orders/new' })}><Plus className="size-4" aria-hidden /> New order</Button> : null}</div>
      <Toolbar><div className="w-48"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, ...Object.entries(ORDER_STATUS).map(([value, label]) => ({ value, label }))]} /></div></Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(o) => o.id} onOpen={(o) => void navigate({ to: '/purchasing/orders/$orderId', params: { orderId: o.id } })} empty="No purchase orders yet." height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
    </div>
  )
}
