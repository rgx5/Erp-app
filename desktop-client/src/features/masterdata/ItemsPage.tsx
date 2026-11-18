import type { ColumnDef } from '@tanstack/react-table'
import { Download, Plus, Upload } from 'lucide-react'
import { useMemo, useState } from 'react'
import { query } from '@/api/client'
import { ApiError } from '@/api/errors'
import { item as itemSchema, page, type Item } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { currentApi, useSession } from '@/auth/session'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { useDebounced } from '@/ui/hooks'
import { Alert, Button, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { download, toCsv } from './csv'
import { ImportDialog, type ImportSpec } from './ImportDialog'
import { ItemBarcodes } from '@/features/retail/ItemBarcodes'
import { hsnProblem, ITEM_TYPES, itemTypeLabel, ItemForm } from './ItemForm'
import { createItemRequest, useItems, useTaxCodes, useUnits } from './queries'

type ItemInput = Parameters<typeof createItemRequest>[0]
const yes = (v: string, fallback: boolean): boolean => (v === '' ? fallback : /^(y|yes|true|1)$/i.test(v))

export function ItemsPage() {
  const granted = useSession((s) => s.me?.permissions ?? [])
  const canWrite = can(granted, 'masterdata:write')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('active')
  const q = useDebounced(search.trim())
  const list = useItems({ ...(q ? { q } : {}), ...(type ? { itemType: type } : {}), ...(status ? { status } : {}) })
  const units = useUnits()
  const taxes = useTaxCodes()
  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [importing, setImporting] = useState(false)

  const unitCode = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.code])), [units.data])
  const taxCode = useMemo(() => new Map((taxes.data ?? []).map((t) => [t.id, t.code])), [taxes.data])
  const columns = useMemo<ColumnDef<Item, unknown>[]>(() => [
    { header: 'Code', accessorKey: 'code', size: 130 },
    { header: 'Name', accessorKey: 'name', size: 280 },
    { header: 'Type', accessorFn: (i) => itemTypeLabel(i.itemType), size: 140 },
    { header: 'HSN / SAC', accessorFn: (i) => i.hsnSacCode ?? '', size: 100 },
    { header: 'GST', accessorFn: (i) => (i.taxCodeId ? taxCode.get(i.taxCodeId) ?? '' : ''), size: 90 },
    { header: 'Unit', accessorFn: (i) => unitCode.get(i.baseUomId) ?? '', size: 70 },
    { header: 'Status', accessorKey: 'status', size: 90 },
  ], [taxCode, unitCode])

  const spec: ImportSpec<ItemInput> = useMemo(() => {
    const unitByCode = new Map((units.data ?? []).map((u) => [u.code.toLowerCase(), u.id]))
    const taxByCode = new Map((taxes.data ?? []).map((t) => [t.code.toLowerCase(), t.id]))
    return {
      title: 'Import items',
      template: { filename: 'items-template.csv', header: ['Code', 'Name', 'Type', 'Unit', 'HSN/SAC', 'GST code', 'Sellable', 'Purchasable'], example: ['SHIRT-M', 'Cotton shirt (M)', 'finished_good', 'NOS', '6205', 'GST12', 'yes', 'yes'] },
      invalidate: ['items'],
      describe: (i) => `${i.code} · ${i.name}`,
      create: (input, key) => createItemRequest(input, key),
      parse: (r) => {
        const itemType = (r['type'] || 'finished_good').toLowerCase().replaceAll(' ', '_')
        if (!ITEM_TYPES.some((t) => t.value === itemType)) return { error: `Type must be one of ${ITEM_TYPES.map((t) => t.value).join(', ')}` }
        if (!r['code'] || !r['name']) return { error: 'Code and name are required' }
        if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$/.test(r['code'])) return { error: 'Code may contain letters, digits and . _ / - only' }
        const uom = unitByCode.get((r['unit'] || 'NOS').toLowerCase())
        if (!uom) return { error: `Unknown unit "${r['unit']}"` }
        const hsn = r['hsnsac'] ?? ''
        const problem = hsnProblem(itemType, hsn)
        if (problem) return { error: problem }
        const tax = r['gstcode'] ? taxByCode.get(r['gstcode'].toLowerCase()) : undefined
        if (r['gstcode'] && !tax) return { error: `Unknown GST code "${r['gstcode']}"` }
        const service = itemType === 'service'
        return { input: { code: r['code'], name: r['name'], itemType: itemType as 'service', baseUomId: uom, ...(hsn ? { hsnSacCode: hsn } : {}), ...(tax ? { taxCodeId: tax } : {}), isStocked: !service, isSellable: yes(r['sellable'] ?? '', true), isPurchasable: yes(r['purchasable'] ?? '', true) } }
      },
    }
  }, [units.data, taxes.data])

  async function exportAll() {
    const all: Item[] = []
    let cursor: string | undefined
    const api = currentApi()
    do {
      const p = await api.call(api.raw.GET('/v1/items', { params: { query: query({ limit: 200, cursor, ...(q ? { q } : {}), ...(type ? { itemType: type } : {}), ...(status ? { status } : {}) }) } }), page(itemSchema))
      all.push(...p.items); cursor = p.nextCursor ?? undefined
    } while (cursor)
    download('items.csv', toCsv(['Code', 'Name', 'Type', 'Unit', 'HSN/SAC', 'GST code', 'Sellable', 'Purchasable', 'Status'], all.map((i) => [i.code, i.name, i.itemType, unitCode.get(i.baseUomId) ?? '', i.hsnSacCode ?? '', i.taxCodeId ? taxCode.get(i.taxCodeId) ?? '' : '', i.isSellable ? 'yes' : 'no', i.isPurchasable ? 'yes' : 'no', i.status])))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Items</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void exportAll()}><Download className="size-4" aria-hidden /> Export</Button>
          {canWrite ? <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="size-4" aria-hidden /> Import</Button> : null}
          {canWrite ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> New item</Button> : null}
        </div>
      </div>
      <Toolbar>
        <div className="w-72"><TextField label="Search" placeholder="Code or name" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-48"><SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All types' }, ...ITEM_TYPES]} /></div>
        <div className="w-40"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: '', label: 'All' }]} /></div>
      </Toolbar>
      {list.error ? <Alert>{list.error instanceof ApiError ? list.error.message : 'Could not load items.'}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.rows} rowKey={(i) => i.id} onOpen={(i) => setEditing(i)} empty={q ? 'No item matches that search.' : 'No items yet.'} height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button> : list.rows.length > 0 ? <p className="text-xs text-muted">{list.rows.length} item{list.rows.length === 1 ? '' : 's'}</p> : null}
      {editing ? <Drawer title={editing === 'new' ? 'New item' : editing.name} onClose={() => setEditing(null)}><ItemForm item={editing === 'new' ? undefined : editing} canWrite={canWrite} onDone={() => setEditing(null)} />{editing === 'new' ? null : <ItemBarcodes item={editing} />}</Drawer> : null}
      {importing ? <ImportDialog spec={spec} onClose={() => setImporting(false)} /> : null}
    </div>
  )
}
