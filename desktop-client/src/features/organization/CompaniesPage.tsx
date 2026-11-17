import type { ColumnDef } from '@tanstack/react-table'
import type { Company } from '@/api/schemas'
import { Alert, Spinner } from '@/ui/primitives'
import { DataTable } from '@/ui/DataTable'
import { useCompanies } from './queries'

const columns: ColumnDef<Company, unknown>[] = [
  { header: 'Legal name', accessorKey: 'legalName', size: 260 },
  { header: 'Trade name', accessorFn: (c) => c.tradeName ?? '', size: 200 },
  { header: 'PAN', accessorFn: (c) => c.pan ?? '', size: 120 },
  { header: 'Currency', accessorKey: 'baseCurrency', size: 90 },
  { header: 'Status', accessorKey: 'status', size: 90 },
]

export function CompaniesPage() {
  const q = useCompanies()
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Companies</h1>
      {q.isPending ? <Spinner /> : null}
      {q.error ? <Alert>{q.error.message}</Alert> : null}
      {q.data ? <DataTable columns={columns} rows={q.data} rowKey={(c) => c.id} empty="No company yet." /> : null}
    </div>
  )
}
