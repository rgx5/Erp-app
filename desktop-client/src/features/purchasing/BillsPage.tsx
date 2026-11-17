import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { BillHeader } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useBills } from './queries'

export const BILL_TYPE: Record<string, string> = { bill: 'Bill', debit_note: 'Debit note' }
const MATCH: Record<string, string> = { matched: 'Matched', overridden: 'Approved outside tolerance', not_applicable: '' }

export function BillsPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'purchasing:post')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const list = useBills({ companyId: ws.company?.id ?? '', ...(status ? { status } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
  const columns = useMemo<ColumnDef<BillHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'billNo', size: 150 }, { header: 'Date', accessorFn: (b) => formatDate(b.billDate), size: 100 },
    { header: 'Supplier', accessorKey: 'supplierName', size: 240 }, { header: "Supplier's invoice", accessorKey: 'supplierInvoiceNo', size: 140 },
    { header: 'Total', accessorFn: (b) => formatInr(b.grandTotal), size: 130, meta: { align: 'right' } }, { header: 'Due', accessorFn: (b) => (b.dueDate ? formatDate(b.dueDate) : ''), size: 100 },
    { header: 'Match', accessorFn: (b) => MATCH[b.matchStatus] ?? b.matchStatus, size: 170 }, { header: 'Status', accessorKey: 'status', size: 90 },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">No company yet. <Link to="/setup" className="underline">Set up your business</Link>.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">Supplier bills</h1>{canPost ? <Button onClick={() => void navigate({ to: '/purchasing/bills/new' })}><Plus className="size-4" aria-hidden /> Enter bill</Button> : null}</div>
      <Toolbar>
        <div className="w-36"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'posted', label: 'Posted' }, { value: 'cancelled', label: 'Cancelled' }]} /></div>
        <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(b) => b.id} onOpen={(b) => void navigate({ to: '/purchasing/bills/$billId', params: { billId: b.id } })} empty="No bills yet." height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
    </div>
  )
}
