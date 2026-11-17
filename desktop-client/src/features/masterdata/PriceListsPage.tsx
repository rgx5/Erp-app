import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import type { Item, PriceList, Price } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { isValid } from '@/domain/money'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, CheckField, SelectField, Spinner, TextField } from '@/ui/primitives'
import { ItemPicker } from './ItemPicker'
import { useAddPrice, useClosePrice, useCreatePriceList, useItemsById, usePriceLists, usePrices, useUnits } from './queries'

const listSchema = z.object({ code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/, 'Capital letters, digits and . _ -'), name: z.string().trim().min(1, 'Required').max(100), kind: z.string(), taxInclusive: z.boolean() })
const priceSchema = z.object({ price: z.string().refine((v) => isValid(v) && Number(v) >= 0, 'An amount such as 499.50'), minQty: z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, 'A quantity, 0 or more'), effectiveFrom: z.string().min(1, 'Required'), effectiveTo: z.string().optional() })

function Prices({ list, canManage }: { list: PriceList; canManage: boolean }) {
  const prices = usePrices(list.id)
  const units = useUnits()
  const add = useAddPrice(list.id)
  const close = useClosePrice(list.id)
  const names = useItemsById((prices.data ?? []).map((p) => p.itemId))
  const [picked, setPicked] = useState<Item | null>(null)
  const [pickError, setPickError] = useState<string | undefined>()
  const [problem, setProblem] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<Price, unknown>[]>(() => {
    const unit = (id: string): string => units.data?.find((u) => u.id === id)?.code ?? ''
    return [
    { header: 'Item', accessorFn: (p) => { const i = names.data?.get(p.itemId); return i ? `${i.code} · ${i.name}` : '…' }, size: 260 },
    { header: 'From qty', accessorFn: (p) => `${Number(p.minQty)} ${unit(p.uomId)}`, size: 90, meta: { align: 'right' } },
    { header: 'Price', accessorFn: (p) => formatInr(p.price), size: 110, meta: { align: 'right' } },
    { header: 'From', accessorFn: (p) => formatDate(p.effectiveFrom), size: 100 },
    { header: 'To', accessorFn: (p) => (p.effectiveTo ? formatDate(p.effectiveTo) : 'open'), size: 100 },
    ...(canManage ? [{ header: '', id: 'close', size: 90, cell: ({ row }: { row: { original: Price } }) => (row.original.effectiveTo ? null : <button type="button" className="text-xs text-brand underline" onClick={() => { setProblem(null); close.mutate({ priceId: row.original.id, effectiveTo: todayIso() }, { onError: (e) => setProblem(e instanceof ApiError ? e.message : 'Could not end the price.') }) }}>End today</button>) } as ColumnDef<Price, unknown>] : []),
  ]
  }, [names.data, units.data, canManage, close.mutate])
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{list.kind === 'sales' ? 'Selling' : 'Buying'} prices in {list.currency}, {list.taxInclusive ? 'including' : 'excluding'} GST. The price that applies is the one in force on the document date for the largest "from quantity" reached.</p>
      {problem ? <Alert>{problem}</Alert> : null}
      {prices.isPending ? <Spinner /> : <DataTable columns={columns} rows={prices.data ?? []} rowKey={(p) => p.id} empty="No prices in this list yet." height={300} />}
      {canManage ? (
        <div className="border-t border-line pt-4">
          <h3 className="mb-2 text-sm font-semibold">Add a price</h3>
          <ItemPicker onPick={(i) => { setPicked(i); setPickError(undefined) }} error={pickError} />
          <div className="mt-3">
            <SimpleForm schema={priceSchema} defaults={{ price: '', minQty: '0', effectiveFrom: todayIso(), effectiveTo: '' }} fields={['itemId', 'uomId', 'price', 'minQty', 'effectiveFrom', 'effectiveTo']} label="Add price"
              submit={async (v) => { if (!picked) { setPickError('Choose an item'); throw new ApiError(422, 'validation_failed', 'Choose an item first') } await add.mutateAsync({ itemId: picked.id, uomId: picked.baseUomId, price: v.price, minQty: v.minQty, effectiveFrom: v.effectiveFrom, ...(v.effectiveTo ? { effectiveTo: v.effectiveTo } : {}) }); setPicked(null) }}>
              {({ register, errors }) => (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <TextField label="Price" inputMode="decimal" error={errors.price?.message as string | undefined} {...register('price')} />
                    <TextField label="From quantity" inputMode="decimal" error={errors.minQty?.message as string | undefined} {...register('minQty')} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <TextField label="Applies from" type="date" error={errors.effectiveFrom?.message as string | undefined} {...register('effectiveFrom')} />
                    <TextField label="Until (optional)" type="date" error={errors.effectiveTo?.message as string | undefined} {...register('effectiveTo')} />
                  </div>
                </>
              )}
            </SimpleForm>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function PriceListsPage() {
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'pricing:manage')
  const lists = usePriceLists()
  const create = useCreatePriceList()
  const [open, setOpen] = useState<PriceList | 'new' | null>(null)
  const columns: ColumnDef<PriceList, unknown>[] = [{ header: 'Code', accessorKey: 'code', size: 120 }, { header: 'Name', accessorKey: 'name', size: 240 }, { header: 'For', accessorFn: (l) => (l.kind === 'sales' ? 'Selling' : 'Buying'), size: 90 }, { header: 'Currency', accessorKey: 'currency', size: 90 }, { header: 'GST', accessorFn: (l) => (l.taxInclusive ? 'Included' : 'Extra'), size: 90 }, { header: 'Status', accessorKey: 'status', size: 90 }]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">Price lists</h1>{canManage ? <Button onClick={() => setOpen('new')}><Plus className="size-4" aria-hidden /> New price list</Button> : null}</div>
      {lists.isPending ? <Spinner /> : <DataTable columns={columns} rows={lists.data ?? []} rowKey={(l) => l.id} onOpen={setOpen} empty="No price lists yet." />}
      {open === 'new' ? (
        <Drawer title="New price list" onClose={() => setOpen(null)}>
          <SimpleForm schema={listSchema} defaults={{ code: '', name: '', kind: 'sales', taxInclusive: false }} fields={['code', 'name', 'kind', 'currency', 'taxInclusive']} label="Create price list" submit={async (v) => { await create.mutateAsync({ code: v.code.trim(), name: v.name.trim(), kind: v.kind as 'sales', taxInclusive: v.taxInclusive }); setOpen(null) }}>
            {({ register, errors }) => (
              <>
                <TextField label="Code" error={errors.code?.message as string | undefined} {...register('code')} hint="For example RETAIL" />
                <TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} />
                <SelectField label="Used for" options={[{ value: 'sales', label: 'Selling prices' }, { value: 'purchase', label: 'Buying prices' }]} {...register('kind')} />
                <CheckField label="Prices include GST" {...register('taxInclusive')} />
              </>
            )}
          </SimpleForm>
        </Drawer>
      ) : open ? <Drawer title={open.name} onClose={() => setOpen(null)} width={680}><Prices list={open} canManage={canManage} /></Drawer> : null}
    </div>
  )
}
