import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { InvoiceHeader } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useInvoices } from './queries'

export const DOC_LABEL: Record<string, string> = { tax_invoice: 'Tax invoice', bill_of_supply: 'Bill of supply', credit_note: 'Credit note', debit_note: 'Debit note' }

export function InvoicesPage() {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const canPost = can(useSession((s) => s.me?.permissions ?? []), 'sales:post')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const list = useInvoices({ companyId: ws.company?.id ?? '', ...(type ? { documentType: type } : {}), ...(status ? { status } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })
  const columns = useMemo<ColumnDef<InvoiceHeader, unknown>[]>(() => [
    { header: 'Number', accessorKey: 'invoiceNo', size: 150 },
    { header: 'Date', accessorFn: (i) => formatDate(i.invoiceDate), size: 100 },
    { header: 'Type', accessorFn: (i) => DOC_LABEL[i.documentType] ?? i.documentType, size: 120 },
    { header: 'Customer', accessorKey: 'customerName', size: 260 },
    { header: 'Total', accessorFn: (i) => formatInr(i.grandTotal), size: 130, meta: { align: 'right' } },
    { header: 'Due', accessorFn: (i) => (i.dueDate ? formatDate(i.dueDate) : ''), size: 100 },
    { header: 'Status', accessorKey: 'status', size: 90 },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">No company yet. <Link to="/setup" className="underline">Set up your business</Link>.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Sales invoices</h1>
        {canPost ? <Button onClick={() => void navigate({ to: '/sales/invoices/new' })}><Plus className="size-4" aria-hidden /> New invoice</Button> : null}
      </div>
      <Toolbar>
        <div className="w-44"><SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All documents' }, ...Object.entries(DOC_LABEL).map(([value, label]) => ({ value, label }))]} /></div>
        <div className="w-36"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: '', label: 'All' }, { value: 'posted', label: 'Posted' }, { value: 'cancelled', label: 'Cancelled' }]} /></div>
        <div className="w-40"><TextField label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="w-40"><TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </Toolbar>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(i) => i.id} onOpen={(i) => void navigate({ to: '/sales/invoices/$invoiceId', params: { invoiceId: i.id } })} empty="No documents match." height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button> : null}
    </div>
  )
}
