import type { ColumnDef } from '@tanstack/react-table'
import { Download, Plus, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { query } from '@/api/client'
import { ApiError } from '@/api/errors'
import { page, party as partySchema, type Party } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { currentApi, useSession } from '@/auth/session'
import { isValidGstin, normalizeGstin } from '@/domain/india'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useDebounced } from '@/ui/hooks'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { download, toCsv } from './csv'
import { ImportDialog, type ImportSpec } from './ImportDialog'
import { GST_TREATMENTS, PartyForm, roleLabel, treatmentLabel } from './PartyForm'
import { createPartyRequest, useParties } from './queries'

type PartyInput = Parameters<typeof createPartyRequest>[0]
const REGISTERED = new Set(['registered_regular', 'registered_composition', 'sez'])

export function PartiesPage({ role }: { role?: 'customer' | 'supplier' }) {
  const granted = useSession((s) => s.me?.permissions ?? [])
  const canWrite = can(granted, 'masterdata:write')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const q = useDebounced(search.trim())
  const list = useParties({ ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}) })
  const [editing, setEditing] = useState<Party | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const noun = role === 'customer' ? 'Customers' : role === 'supplier' ? 'Suppliers' : 'Parties'

  const columns = useMemo<ColumnDef<Party, unknown>[]>(() => [
    { header: 'Code', accessorKey: 'code', size: 120 },
    { header: 'Name', accessorFn: (p) => p.tradeName ? `${p.legalName} (${p.tradeName})` : p.legalName, size: 300 },
    { header: 'GSTIN', accessorFn: (p) => p.gstin ?? '', size: 160 },
    { header: 'GST treatment', accessorFn: (p) => treatmentLabel(p.gstTreatment), size: 170 },
    { header: 'Role', accessorFn: (p) => roleLabel(p), size: 150 },
    { header: 'Status', accessorKey: 'status', size: 90 },
  ], [])

  const spec: ImportSpec<PartyInput> = useMemo(() => ({
    title: `Import ${noun.toLowerCase()}`,
    template: { filename: 'parties-template.csv', header: ['Code', 'Legal name', 'Trade name', 'Role', 'GST treatment', 'GSTIN', 'PAN'], example: ['CUST-001', 'Asha Traders', 'Asha', 'customer', 'registered_regular', '27ABCDE1234F1Z5', ''] },
    invalidate: ['parties'],
    describe: (i) => `${i.code} · ${i.legalName}`,
    create: (input, key) => createPartyRequest(input, key),
    parse: (r) => {
      const asked = (r['role'] || role || 'customer').toLowerCase()
      if (!['customer', 'supplier', 'subcontractor', 'both'].includes(asked)) return { error: 'Role must be customer, supplier, subcontractor or both' }
      const treatment = (r['gsttreatment'] || 'consumer').toLowerCase()
      if (!GST_TREATMENTS.some((t) => t.value === treatment)) return { error: `GST treatment must be one of ${GST_TREATMENTS.map((t) => t.value).join(', ')}` }
      if (!r['code'] || !r['legalname']) return { error: 'Code and legal name are required' }
      if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$/.test(r['code'])) return { error: 'Code may contain letters, digits and . _ / - only' }
      const gstin = normalizeGstin(r['gstin'] ?? '')
      if (REGISTERED.has(treatment) !== (gstin !== '')) return { error: REGISTERED.has(treatment) ? 'A registered party needs a GSTIN' : 'This GST treatment has no GSTIN' }
      if (gstin && !isValidGstin(gstin)) return { error: 'This GSTIN is not valid' }
      const pan = (r['pan'] ?? '').toUpperCase()
      return { input: { code: r['code'], legalName: r['legalname'], ...(r['tradename'] ? { tradeName: r['tradename'] } : {}), isCustomer: asked === 'customer' || asked === 'both', isSupplier: asked === 'supplier' || asked === 'both', isSubcontractor: asked === 'subcontractor', gstTreatment: treatment as 'consumer', ...(gstin ? { gstin } : {}), ...(pan ? { pan } : {}) } }
    },
  }), [noun, role])

  async function exportAll() {
    const all: Party[] = []
    let cursor: string | undefined
    const api = currentApi()
    do {
      const p = await api.call(api.raw.GET('/v1/parties', { params: { query: query({ limit: 200, cursor, ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}) }) } }), page(partySchema))
      all.push(...p.items); cursor = p.nextCursor ?? undefined
    } while (cursor)
    download(`${noun.toLowerCase()}.csv`, toCsv(['Code', 'Legal name', 'Trade name', 'Role', 'GST treatment', 'GSTIN', 'PAN', 'Status'], all.map((p) => [p.code, p.legalName, p.tradeName ?? '', roleLabel(p), p.gstTreatment, p.gstin ?? '', p.pan ?? '', p.status])))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">{noun}</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void exportAll()}><Download className="size-4" aria-hidden /> Export</Button>
          {canWrite ? <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="size-4" aria-hidden /> Import</Button> : null}
          {canWrite ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> New {role ?? 'party'}</Button> : null}
        </div>
      </div>
      <Toolbar>
        <div className="w-80"><TextField label="Search" placeholder="Name, code or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-40"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'blocked', label: 'Blocked' }, { value: '', label: 'All' }]} /></div>
      </Toolbar>
      {list.error ? <Alert>{list.error instanceof ApiError ? list.error.message : 'Could not load.'}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(p) => p.id} onOpen={(p) => setEditing(p)} empty={q ? 'Nobody matches that search.' : `No ${noun.toLowerCase()} yet.`} height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button> : list.rows.length > 0 ? <p className="text-xs text-muted">{list.rows.length} record{list.rows.length === 1 ? '' : 's'}</p> : null}
      {editing ? <Drawer title={editing === 'new' ? `New ${role ?? 'party'}` : editing.legalName} onClose={() => setEditing(null)} width={580}><PartyForm party={editing === 'new' ? undefined : editing} canWrite={canWrite} defaultRole={role} onDone={() => setEditing(null)} /></Drawer> : null}
      {importing ? <ImportDialog spec={spec} onClose={() => setImporting(false)} /> : null}
    </div>
  )
}
