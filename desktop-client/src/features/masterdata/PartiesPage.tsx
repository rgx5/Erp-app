import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/errors'
import type { Party } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { isValidGstin, normalizeGstin } from '@/domain/india'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useDebounced } from '@/ui/hooks'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import type { ImportSpec } from './ImportDialog'
import { GST_TREATMENTS, PartyForm, roleLabel, treatmentLabel } from './PartyForm'
import { resolveRole, resolveTreatment } from '@/features/import/resolvers'
import { createPartyRequest, useParties } from './queries'

type PartyInput = Parameters<typeof createPartyRequest>[0]
const REGISTERED = new Set(['registered_regular', 'registered_composition', 'sez'])

/** What the Data section needs to import customers or suppliers from a file. */
export function usePartyImportSpec(role?: 'customer' | 'supplier'): ImportSpec<PartyInput> {
  const noun = role === 'customer' ? 'Customers' : role === 'supplier' ? 'Suppliers' : 'Parties'
  return useMemo(() => ({
    title: `Import ${noun.toLowerCase()}`,
    template: { filename: 'parties-template.csv', header: ['Code', 'Legal name', 'Trade name', 'Role', 'GST treatment', 'GSTIN', 'PAN', 'Phone', 'Email'], example: ['CUST-001', 'Asha Traders', 'Asha', 'customer', 'registered_regular', '27ABCDE1234F1Z5', '', '9876543210', 'asha@example.com'] },
    invalidate: ['parties'],
    nameKey: 'legalname',
    hints: ['name', 'party', 'parties', 'customer', 'supplier', 'vendor', 'ledger', 'contact', 'account'],
    values: [
      { key: 'role', label: 'Role', options: [{ value: 'customer', label: 'Customer' }, { value: 'supplier', label: 'Supplier' }, { value: 'both', label: 'Customer and supplier' }, { value: 'subcontractor', label: 'Subcontractor' }], resolve: (raw) => (['customer', 'supplier', 'subcontractor', 'both'].includes(raw.toLowerCase()) ? raw.toLowerCase() : resolveRole(raw)) },
      { key: 'gsttreatment', label: 'GST treatment', options: GST_TREATMENTS.map((t) => ({ value: t.value, label: t.label })), resolve: (raw) => (GST_TREATMENTS.some((t) => t.value === raw.toLowerCase()) ? raw.toLowerCase() : resolveTreatment(raw)) },
    ],
    describe: (i) => `${i.code} · ${i.legalName}`,
    create: (input, key) => createPartyRequest(input, key),
    parse: (r) => {
      const asked = (r['role'] || role || 'customer').toLowerCase()
      if (!['customer', 'supplier', 'subcontractor', 'both'].includes(asked)) return { error: 'Role must be customer, supplier, subcontractor or both' }
      const gstin = normalizeGstin(r['gstin'] ?? '')
      const treatment = (r['gsttreatment'] || (gstin ? 'registered_regular' : 'consumer')).toLowerCase()
      if (!GST_TREATMENTS.some((t) => t.value === treatment)) return { error: `GST treatment must be one of ${GST_TREATMENTS.map((t) => t.value).join(', ')}` }
      if (!r['code'] || !r['legalname']) return { error: 'Code and legal name are required' }
      if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$/.test(r['code'])) return { error: 'Code may contain letters, digits and . _ / - only' }
      if (REGISTERED.has(treatment) !== (gstin !== '')) return { error: REGISTERED.has(treatment) ? 'A registered party needs a GSTIN' : 'This GST treatment has no GSTIN' }
      if (gstin && !isValidGstin(gstin)) return { error: 'This GSTIN is not valid' }
      const pan = (r['pan'] ?? '').toUpperCase()
      const phone = (r['phone'] ?? '').trim(); const email = (r['email'] ?? '').trim()
      if (phone && !/^[0-9+() -]{6,20}$/.test(phone)) return { error: 'Phone: digits, spaces, + ( ) and - only' }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'Email is not valid' }
      return { input: { code: r['code'], legalName: r['legalname'].slice(0, 300), ...(r['tradename'] ? { tradeName: r['tradename'] } : {}), isCustomer: asked === 'customer' || asked === 'both', isSupplier: asked === 'supplier' || asked === 'both', isSubcontractor: asked === 'subcontractor', gstTreatment: treatment as 'consumer', ...(gstin ? { gstin } : {}), ...(pan ? { pan } : {}), ...(phone ? { phone } : {}), ...(email ? { email } : {}) } }
    },
  }), [noun, role])
}

export function PartiesPage({ role }: { role?: 'customer' | 'supplier' }) {
  const granted = useSession((s) => s.me?.permissions ?? [])
  const canWrite = can(granted, 'masterdata:write')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const q = useDebounced(search.trim())
  const list = useParties({ ...(q ? { q } : {}), ...(role ? { role } : {}), ...(status ? { status } : {}) })
  const [editing, setEditing] = useState<Party | 'new' | null>(null)
  const navigate = useNavigate()
  const noun = role === 'customer' ? 'Customers' : role === 'supplier' ? 'Suppliers' : 'Parties'

  const columns = useMemo<ColumnDef<Party, unknown>[]>(() => [
    { header: 'Code', accessorKey: 'code', size: 120 },
    { header: 'Name', accessorFn: (p) => p.tradeName ? `${p.legalName} (${p.tradeName})` : p.legalName, size: 300 },
    { header: 'GSTIN', accessorFn: (p) => p.gstin ?? '', size: 160 },
    { header: 'GST treatment', accessorFn: (p) => treatmentLabel(p.gstTreatment), size: 170 },
    { header: 'Role', accessorFn: (p) => roleLabel(p), size: 150 },
    { header: 'Status', accessorKey: 'status', size: 90 },
  ], [])


  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">{noun}</h1>
        <div className="flex gap-2">
          {canWrite ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> New {role ?? 'party'}</Button> : null}
        </div>
      </div>
      <Toolbar>
        <div className="w-80"><TextField label="Search" placeholder="Name, code or GSTIN" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-40"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'blocked', label: 'Blocked' }, { value: '', label: 'All' }]} /></div>
      </Toolbar>
      {list.error ? <Alert>{list.error instanceof ApiError ? list.error.message : 'Could not load.'}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(p) => p.id} onOpen={(p) => void navigate({ to: '/masterdata/parties/$partyId', params: { partyId: p.id } })} empty={q ? 'Nobody matches that search.' : `No ${noun.toLowerCase()} yet.`} height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button> : list.rows.length > 0 ? <p className="text-xs text-muted">{list.rows.length} record{list.rows.length === 1 ? '' : 's'}</p> : null}
      {editing ? <Drawer title={editing === 'new' ? `New ${role ?? 'party'}` : editing.legalName} onClose={() => setEditing(null)} width={580}><PartyForm party={editing === 'new' ? undefined : editing} canWrite={canWrite} defaultRole={role} onDone={() => setEditing(null)} /></Drawer> : null}
    </div>
  )
}
