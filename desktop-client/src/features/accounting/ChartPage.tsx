import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import type { LedgerAccount } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, CheckField, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { useAccounts, useCreateAccount, useUpdateAccount } from './queries'

const TYPES = [{ value: 'asset', label: 'Asset' }, { value: 'liability', label: 'Liability' }, { value: 'equity', label: 'Equity' }, { value: 'income', label: 'Income' }, { value: 'expense', label: 'Expense' }]
const CONTROL: Record<string, string> = { receivable: 'Receivables', payable: 'Payables', inventory: 'Stock', work_in_progress: 'Work in progress', tax: 'Tax' }
const newSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/, 'Letters, digits and . _ - (max 20)'), name: z.string().trim().min(1, 'Required').max(200), type: z.string(), parentId: z.string(), isGroup: z.boolean() })
const editSchema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/, 'Letters, digits and . _ - (max 20)'), name: z.string().trim().min(1, 'Required').max(200), status: z.string() })

export function ChartPage() {
  const ws = useWorkspace()
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'accounting:manage')
  const accounts = useAccounts(ws.company?.id)
  const create = useCreateAccount()
  const update = useUpdateAccount()
  const [type, setType] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<LedgerAccount | 'new' | null>(null)
  const depth = useMemo(() => {
    const byId = new Map((accounts.data ?? []).map((a) => [a.id, a]))
    const d = (a: LedgerAccount): number => (a.parentId && byId.get(a.parentId) ? 1 + d(byId.get(a.parentId) as LedgerAccount) : 0)
    return new Map((accounts.data ?? []).map((a) => [a.id, d(a)]))
  }, [accounts.data])
  const rows = useMemo(() => (accounts.data ?? []).filter((a) => (!type || a.type === type) && (!search.trim() || `${a.code} ${a.name}`.toLowerCase().includes(search.trim().toLowerCase()))).sort((a, b) => a.code.localeCompare(b.code)), [accounts.data, type, search])
  const columns = useMemo<ColumnDef<LedgerAccount, unknown>[]>(() => [
    { header: 'Code', accessorKey: 'code', size: 110 },
    { header: 'Name', size: 340, accessorFn: (a) => `${'   '.repeat(depth.get(a.id) ?? 0)}${a.name}${a.isGroup ? ' (group)' : ''}` },
    { header: 'Type', accessorFn: (a) => TYPES.find((t) => t.value === a.type)?.label ?? a.type, size: 100 },
    { header: 'Kept by', accessorFn: (a) => (a.controlKind ? `${CONTROL[a.controlKind] ?? a.controlKind} (system)` : ''), size: 160 },
    { header: 'Status', accessorKey: 'status', size: 90 },
  ], [depth])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  const groups = (accounts.data ?? []).filter((a) => a.isGroup && a.status === 'active')
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">Chart of accounts</h1>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => download('chart-of-accounts.csv', toCsv(['Code', 'Name', 'Type', 'Group', 'Status'], rows.map((a) => [a.code, a.name, a.type, a.isGroup ? 'yes' : 'no', a.status])))}>Export</Button>{canManage ? <Button onClick={() => setOpen('new')}><Plus className="size-4" aria-hidden /> New account</Button> : null}</div></div>
      <Toolbar>
        <div className="w-72"><TextField label="Search" placeholder="Code or name" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-44"><SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All types' }, ...TYPES]} /></div>
      </Toolbar>
      <p className="text-xs text-muted">Accounts marked "system" are kept by receivables, payables, stock or tax: documents post to them, never a manual journal.</p>
      {accounts.error ? <Alert>{accounts.error.message}</Alert> : null}
      {accounts.isPending ? <Spinner /> : <DataTable columns={columns} rows={rows} rowKey={(a) => a.id} onOpen={(a) => setOpen(a)} empty="No accounts match." height={560} />}
      {open === 'new' ? (
        <Drawer title="New account" onClose={() => setOpen(null)}>
          <SimpleForm schema={newSchema} defaults={{ code: '', name: '', type: 'expense', parentId: '', isGroup: false }} fields={['code', 'name', 'type', 'parentId', 'isGroup']} label="Create account"
            submit={async (v) => { await create.mutateAsync({ companyId: ws.company?.id as string, code: v.code.trim(), name: v.name.trim(), type: v.type as 'asset', ...(v.parentId ? { parentId: v.parentId } : {}), isGroup: v.isGroup }); setOpen(null) }}>
            {({ register, errors }) => (
              <>
                <TextField label="Code" error={errors.code?.message as string | undefined} {...register('code')} />
                <TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} />
                <SelectField label="Type" options={TYPES} {...register('type')} />
                <SelectField label="Under (group)" options={[{ value: '', label: 'Top level' }, ...groups.map((g) => ({ value: g.id, label: `${g.code} · ${g.name}` }))]} {...register('parentId')} />
                <CheckField label="This is a group (a heading that holds other accounts)" {...register('isGroup')} />
              </>
            )}
          </SimpleForm>
        </Drawer>
      ) : open ? (
        <Drawer title={`${open.code} · ${open.name}`} onClose={() => setOpen(null)}>
          <SimpleForm schema={editSchema} defaults={{ code: open.code, name: open.name, status: open.status }} fields={['code', 'name', 'status']} label="Save changes"
            submit={async (v) => { await update.mutateAsync({ id: open.id, version: open.version, body: { code: v.code.trim(), name: v.name.trim(), status: v.status as 'active' } }); setOpen(null) }}>
            {({ register, errors }) => (
              <>
                {open.controlKind ? <Alert tone="info">This account is kept by the system ({CONTROL[open.controlKind] ?? open.controlKind}). You can rename it.</Alert> : null}
                <TextField label="Code" error={errors.code?.message as string | undefined} disabled={!canManage} {...register('code')} />
                <TextField label="Name" error={errors.name?.message as string | undefined} disabled={!canManage} {...register('name')} />
                <SelectField label="Status" disabled={!canManage} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive (cannot be posted to)' }]} {...register('status')} />
                <p className="text-xs text-muted">The type and the place in the chart cannot be changed once an account exists.</p>
              </>
            )}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}
