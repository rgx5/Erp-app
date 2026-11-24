import type { ColumnDef } from '@tanstack/react-table'
import { Download, Plus, Printer, Upload } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
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
import { ItemPhoto } from '@/features/attachments/AttachmentsPanel'
import { VariantsDrawer } from './VariantsDrawer'
import { ItemBarcodes } from '@/features/retail/ItemBarcodes'
import { hsnProblem, ITEM_TYPES, itemTypeLabel, ItemForm } from './ItemForm'
import { formatInr } from '@/domain/format'
import { resolveByCodeOrName, resolveItemType, resolveTax, resolveUnit } from '@/features/import/resolvers'
import { createItemRequest, useCategories, useItems, useTaxCodes, useUnits } from './queries'

type ItemInput = Parameters<typeof createItemRequest>[0]
const yes = (v: string, fallback: boolean): boolean => (v === '' ? fallback : /^(y|yes|true|1)$/i.test(v))

export function ItemsPage() {
  const granted = useSession((s) => s.me?.permissions ?? [])
  const canWrite = can(granted, 'masterdata:write')
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [status, setStatus] = useState('active')
  const [categoryId, setCategoryId] = useState('')
  const categories = useCategories()
  const q = useDebounced(search.trim())
  const list = useItems({ ...(q ? { q } : {}), ...(type ? { itemType: type } : {}), ...(status ? { status } : {}) })
  const units = useUnits()
  const taxes = useTaxCodes()
  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [importing, setImporting] = useState(false)
  const [variants, setVariants] = useState(false)

  const unitCode = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.code])), [units.data])
  const taxCode = useMemo(() => new Map((taxes.data ?? []).map((t) => [t.id, t.code])), [taxes.data])
  const catName = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data])
  const catByCode = useMemo(() => new Map((categories.data ?? []).map((c) => [c.code.toLowerCase(), c.id])), [categories.data])
  const catCode = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c.code])), [categories.data])
  const rows = useMemo(() => (categoryId ? list.rows.filter((i) => i.categoryId === categoryId) : list.rows), [list.rows, categoryId])
  const columns = useMemo<ColumnDef<Item, unknown>[]>(() => [
    { header: 'Code', accessorKey: 'code', size: 130 },
    { header: 'Name', accessorKey: 'name', size: 280 },
    { header: 'Type', accessorFn: (i) => itemTypeLabel(i.itemType), size: 140 },
    { header: 'HSN / SAC', accessorFn: (i) => i.hsnSacCode ?? '', size: 100 },
    { header: 'GST', accessorFn: (i) => (i.taxCodeId ? taxCode.get(i.taxCodeId) ?? '' : ''), size: 90 },
    { header: 'Category', accessorFn: (i) => (i.categoryId ? catName.get(i.categoryId) ?? '' : ''), size: 130 },
    { header: 'Brand', accessorFn: (i) => i.brand ?? '', size: 100 },
    { header: 'Size', accessorFn: (i) => i.size ?? '', size: 70 },
    { header: 'Colour', accessorFn: (i) => i.colour ?? '', size: 90 },
    { header: 'MRP', accessorFn: (i) => (i.mrp ? formatInr(i.mrp, { symbol: false }) : ''), size: 90, meta: { align: 'right' } },
    { header: 'Unit', accessorFn: (i) => unitCode.get(i.baseUomId) ?? '', size: 70 },
    { header: 'Status', accessorKey: 'status', size: 90 },
  ], [taxCode, unitCode, catName])

  const spec: ImportSpec<ItemInput> = useMemo(() => {
    const unitByCode = new Map((units.data ?? []).map((u) => [u.code.toLowerCase(), u.id]))
    const taxByCode = new Map((taxes.data ?? []).map((t) => [t.code.toLowerCase(), t.id]))
    const unitList = units.data ?? []; const taxList = taxes.data ?? []; const catList = categories.data ?? []
    return {
      title: 'Import items',
      template: { filename: 'items-template.csv', header: ['Code', 'Name', 'Type', 'Unit', 'HSN/SAC', 'GST code', 'Sellable', 'Purchasable', 'Category code', 'Brand', 'MRP'], example: ['SHIRT-M', 'Cotton shirt (M)', 'finished_good', 'NOS', '6205', 'GST12', 'yes', 'yes', 'MEN-SHIRTS', 'Acme', '1299'] },
      invalidate: ['items'],
      nameKey: 'name',
      hints: ['item', 'product', 'stock', 'goods', 'inventory', 'material'],
      values: [
        { key: 'type', label: 'Type', options: ITEM_TYPES.map((t) => ({ value: t.value, label: t.label })), resolve: (raw) => (ITEM_TYPES.some((t) => t.value === raw.toLowerCase().replaceAll(' ', '_')) ? raw.toLowerCase().replaceAll(' ', '_') : resolveItemType(raw)) },
        { key: 'unit', label: 'Unit', options: unitList.map((u) => ({ value: u.code, label: `${u.code} · ${u.name}` })), resolve: (raw) => resolveUnit(unitList, raw) },
        { key: 'gstcode', label: 'GST', options: taxList.map((t) => ({ value: t.code, label: `${t.code} · ${t.name}` })), resolve: (raw) => resolveTax(taxList, raw) },
        { key: 'categorycode', label: 'Category', options: catList.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` })), resolve: (raw) => resolveByCodeOrName(catList, raw) },
      ],
      describe: (i) => `${i.code} · ${i.name}`,
      create: (input, key) => createItemRequest(input, key),
      parse: (r) => {
        const itemType = (r['type'] || 'finished_good').toLowerCase().replaceAll(' ', '_')
        if (!ITEM_TYPES.some((t) => t.value === itemType)) return { error: `Type must be one of ${ITEM_TYPES.map((t) => t.value).join(', ')}` }
        if (!r['code'] || !r['name']) return { error: 'Code and name are required' }
        if (!/^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$/.test(r['code'])) return { error: 'Code may contain letters, digits and . _ / - only' }
        const uom = unitByCode.get((r['unit'] || 'NOS').toLowerCase())
        if (!uom) return { error: `Unknown unit "${r['unit']}"` }
        const hsn = (r['hsnsac'] ?? '').replace(/[\s.-]/g, '')
        const problem = hsnProblem(itemType, hsn)
        if (problem) return { error: problem }
        const tax = r['gstcode'] ? taxByCode.get(r['gstcode'].toLowerCase()) : undefined
        if (r['gstcode'] && !tax) return { error: `Unknown GST code "${r['gstcode']}"` }
        const category = r['categorycode'] ? catByCode.get(r['categorycode'].toLowerCase()) : undefined
        if (r['categorycode'] && !category) return { error: `Unknown category code "${r['categorycode']}"` }
        const mrp = (r['mrp'] ?? '').replace(/[₹,\s]/g, '')
        if (mrp && !/^\d{1,14}(\.\d{1,4})?$/.test(mrp)) return { error: 'MRP must be an amount such as 1299' }
        if ((r['brand'] ?? '').length > 100) return { error: 'Brand is too long' }
        const service = itemType === 'service'
        return { input: { code: r['code'], name: r['name'].slice(0, 300), itemType: itemType as 'service', baseUomId: uom, ...(hsn ? { hsnSacCode: hsn } : {}), ...(tax ? { taxCodeId: tax } : {}), isStocked: !service, isSellable: yes(r['sellable'] ?? '', true), isPurchasable: yes(r['purchasable'] ?? '', true), ...(category ? { categoryId: category } : {}), ...(r['brand'] ? { brand: r['brand'] } : {}), ...(mrp && Number(mrp) > 0 ? { mrp } : {}) } }
      },
    }
  }, [units.data, taxes.data, categories.data, catByCode])

  async function exportAll() {
    const all: Item[] = []
    let cursor: string | undefined
    const api = currentApi()
    do {
      const p = await api.call(api.raw.GET('/v1/items', { params: { query: query({ limit: 200, cursor, ...(q ? { q } : {}), ...(type ? { itemType: type } : {}), ...(status ? { status } : {}) }) } }), page(itemSchema))
      all.push(...p.items); cursor = p.nextCursor ?? undefined
    } while (cursor)
    download('items.csv', toCsv(['Code', 'Name', 'Type', 'Unit', 'HSN/SAC', 'GST code', 'Sellable', 'Purchasable', 'Status', 'Category code', 'Brand', 'MRP'], all.map((i) => [i.code, i.name, i.itemType, unitCode.get(i.baseUomId) ?? '', i.hsnSacCode ?? '', i.taxCodeId ? taxCode.get(i.taxCodeId) ?? '' : '', i.isSellable ? 'yes' : 'no', i.isPurchasable ? 'yes' : 'no', i.status, i.categoryId ? catCode.get(i.categoryId) ?? '' : '', i.brand ?? '', i.mrp ?? ''])))
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Items</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void exportAll()}><Download className="size-4" aria-hidden /> Export</Button>
          <Button variant="secondary" onClick={() => void navigate({ to: '/masterdata/labels' })}><Printer className="size-4" aria-hidden /> Print labels</Button>
          {canWrite ? <Button variant="secondary" onClick={() => setImporting(true)}><Upload className="size-4" aria-hidden /> Import</Button> : null}
          {canWrite ? <Button variant="secondary" onClick={() => setVariants(true)}>New variants</Button> : null}
          {canWrite ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> New item</Button> : null}
        </div>
      </div>
      <Toolbar>
        <div className="w-72"><TextField label="Search" placeholder="Code or name" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-48"><SelectField label="Type" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: '', label: 'All types' }, ...ITEM_TYPES]} /></div>
        <div className="w-48"><SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={[{ value: '', label: 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} /></div>
        <div className="w-40"><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: '', label: 'All' }]} /></div>
      </Toolbar>
      {list.error ? <Alert>{list.error instanceof ApiError ? list.error.message : 'Could not load items.'}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={rows} rowKey={(i) => i.id} onOpen={(i) => setEditing(i)} empty={q ? 'No item matches that search.' : 'No items yet.'} height={560} />}
      {list.hasNextPage ? <Button variant="secondary" className="self-start" busy={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button> : list.rows.length > 0 ? <p className="text-xs text-muted">{list.rows.length} item{list.rows.length === 1 ? '' : 's'}</p> : null}
      {editing ? <Drawer title={editing === 'new' ? 'New item' : editing.name} onClose={() => setEditing(null)}>{editing === 'new' ? null : <div className="mb-4"><ItemPhoto itemId={editing.id} canWrite={canWrite} /></div>}<ItemForm item={editing === 'new' ? undefined : editing} canWrite={canWrite} onDone={() => setEditing(null)} />{editing === 'new' ? null : <ItemBarcodes item={editing} />}</Drawer> : null}
      {variants ? <VariantsDrawer onClose={() => setVariants(false)} /> : null}
      {importing ? <ImportDialog spec={spec} onClose={() => setImporting(false)} /> : null}
    </div>
  )
}
