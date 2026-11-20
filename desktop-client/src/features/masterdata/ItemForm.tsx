import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { Item } from '@/api/schemas'
import { Alert, Button, CheckField, SelectField, TextField } from '@/ui/primitives'
import { showApiError } from '@/features/setup/forms'
import { useCategories, useCreateItem, useTaxCodes, useUnits, useUpdateItem } from './queries'

export const ITEM_TYPES = [
  { value: 'finished_good', label: 'Finished good' }, { value: 'trading_good', label: 'Trading good' }, { value: 'raw_material', label: 'Raw material' },
  { value: 'packing_material', label: 'Packing material' }, { value: 'semi_finished', label: 'Semi-finished' }, { value: 'consumable', label: 'Consumable' }, { value: 'service', label: 'Service' },
] as const
export const itemTypeLabel = (v: string): string => ITEM_TYPES.find((t) => t.value === v)?.label ?? v

/** The same rules the server applies, so a mistake is shown before the request is sent. The server stays the authority. */
export const hsnProblem = (type: string, hsn: string): string | null => {
  if (!hsn) return null
  return type === 'service' ? (/^99[0-9]{4}$/.test(hsn) ? null : 'A SAC is 6 digits starting 99') : /^([0-9]{4}|[0-9]{6}|[0-9]{8})$/.test(hsn) ? null : 'An HSN is 4, 6 or 8 digits'
}

const schema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$/, 'Letters, digits and . _ / - (max 40)'),
  name: z.string().trim().min(1, 'Required').max(300), description: z.string().max(2000).optional(), itemType: z.string(), baseUomId: z.string().min(1, 'Choose a unit'),
  hsnSacCode: z.string().optional(), taxCodeId: z.string().optional(), tracking: z.string(), isStocked: z.boolean(), isPurchasable: z.boolean(), isSellable: z.boolean(), isManufactured: z.boolean(), costingMethod: z.string(), status: z.string(),
  categoryId: z.string().optional(), brand: z.string().trim().max(100).optional(), mrp: z.string().trim().regex(/^(\d{1,14}(\.\d{1,4})?)?$/, 'An amount such as 120 or 120.50').optional(),
  reorderLevel: z.string().trim().regex(/^(\d{1,12}(\.\d{1,6})?)?$/, 'A quantity such as 10 or 2.5').optional(), reorderQty: z.string().trim().regex(/^(\d{1,12}(\.\d{1,6})?)?$/, 'A quantity such as 10 or 2.5').optional(),
}).superRefine((v, ctx) => {
  const problem = hsnProblem(v.itemType, (v.hsnSacCode ?? '').trim())
  if (problem) ctx.addIssue({ code: 'custom', path: ['hsnSacCode'], message: problem })
  if (v.itemType === 'service' && v.tracking !== 'none') ctx.addIssue({ code: 'custom', path: ['tracking'], message: 'A service cannot be tracked' })
  if (v.isManufactured && v.itemType !== 'semi_finished' && v.itemType !== 'finished_good') ctx.addIssue({ code: 'custom', path: ['isManufactured'], message: 'Only semi-finished or finished goods are manufactured' })
})

export function ItemForm({ item, canWrite, onDone }: { item?: Item | undefined; canWrite: boolean; onDone: () => void }) {
  const units = useUnits()
  const taxes = useTaxCodes()
  const categories = useCategories()
  const create = useCreateItem()
  const update = useUpdateItem()
  const editing = Boolean(item)
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      code: item?.code ?? '', name: item?.name ?? '', description: item?.description ?? '', itemType: item?.itemType ?? 'finished_good', baseUomId: item?.baseUomId ?? '',
      hsnSacCode: item?.hsnSacCode ?? '', taxCodeId: item?.taxCodeId ?? '', tracking: item?.tracking ?? 'none', isStocked: item?.isStocked ?? true, isPurchasable: item?.isPurchasable ?? true,
      isSellable: item?.isSellable ?? true, isManufactured: item?.isManufactured ?? false, costingMethod: item?.costingMethod ?? 'weighted_average', status: item?.status ?? 'active',
      categoryId: item?.categoryId ?? '', brand: item?.brand ?? '', mrp: item?.mrp ? String(Number(item.mrp)) : '', reorderLevel: item?.reorderLevel ? String(Number(item.reorderLevel)) : '', reorderQty: item?.reorderQty ? String(Number(item.reorderQty)) : '',
    },
  })
  const [message, setMessage] = useState<string | null>(null)
  const type = watch('itemType')
  const service = type === 'service'
  const fields = ['code', 'name', 'description', 'itemType', 'baseUomId', 'hsnSacCode', 'taxCodeId', 'tracking', 'isStocked', 'isPurchasable', 'isSellable', 'isManufactured', 'costingMethod', 'status', 'categoryId', 'brand', 'mrp', 'reorderLevel', 'reorderQty']
  const readOnly = !canWrite

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(async (v) => {
      setMessage(null)
      const hsn = (v.hsnSacCode ?? '').trim()
      try {
        if (item) {
          await update.mutateAsync({ id: item.id, version: item.version, body: { name: v.name.trim(), description: v.description?.trim() || null, hsnSacCode: hsn || null, taxCodeId: v.taxCodeId || null, categoryId: v.categoryId || null, brand: v.brand?.trim() || null, mrp: v.mrp?.trim() || null, reorderLevel: v.reorderLevel?.trim() || null, reorderQty: v.reorderQty?.trim() || null, isPurchasable: v.isPurchasable, isSellable: v.isSellable, ...(service ? {} : { costingMethod: v.costingMethod as 'fifo' }), status: v.status as 'active' } })
        } else {
          await create.mutateAsync({
            code: v.code.trim(), name: v.name.trim(), ...(v.description?.trim() ? { description: v.description.trim() } : {}), itemType: v.itemType as 'service', baseUomId: v.baseUomId,
            ...(hsn ? { hsnSacCode: hsn } : {}), ...(v.taxCodeId ? { taxCodeId: v.taxCodeId } : {}), ...(v.categoryId ? { categoryId: v.categoryId } : {}), ...(v.brand?.trim() ? { brand: v.brand.trim() } : {}), ...(v.mrp?.trim() ? { mrp: v.mrp.trim() } : {}), ...(v.reorderLevel?.trim() ? { reorderLevel: v.reorderLevel.trim() } : {}), ...(v.reorderQty?.trim() ? { reorderQty: v.reorderQty.trim() } : {}), tracking: v.tracking as 'none', isStocked: service ? false : v.isStocked,
            isPurchasable: v.isPurchasable, isSellable: v.isSellable, isManufactured: v.isManufactured, ...(service ? {} : { costingMethod: v.costingMethod as 'fifo' }),
          })
        }
        onDone()
      } catch (e) { setMessage(showApiError(e, setError, fields)) }
    })}>
      {editing && item ? <p className="text-xs text-muted">Item code, type, unit and stock tracking cannot be changed after creation{item.isStocked ? ' (stock may already exist)' : ''}.</p> : null}
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Code" error={errors.code?.message} disabled={editing || readOnly} {...register('code')} />
        <SelectField label="Type" options={ITEM_TYPES} disabled={editing || readOnly} {...register('itemType')} />
      </div>
      <TextField label="Name" error={errors.name?.message} disabled={readOnly} {...register('name')} />
      <TextField label="Description (optional)" error={errors.description?.message} disabled={readOnly} {...register('description')} />
      <div className="grid grid-cols-2 gap-4">
        <SelectField label="Unit" error={errors.baseUomId?.message} disabled={editing || readOnly} options={[{ value: '', label: 'Choose…' }, ...(units.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))]} {...register('baseUomId')} />
        <TextField label={service ? 'SAC' : 'HSN'} inputMode="numeric" error={errors.hsnSacCode?.message} disabled={readOnly} {...register('hsnSacCode')} hint={service ? '6 digits starting 99' : '4, 6 or 8 digits'} />
      </div>
      <SelectField label="GST tax code" disabled={readOnly} options={[{ value: '', label: 'None' }, ...(taxes.data ?? []).filter((t) => t.status === 'active').map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` }))]} {...register('taxCodeId')} />
      <div className="grid grid-cols-3 gap-4">
        <SelectField label="Category" disabled={readOnly} options={[{ value: '', label: 'None' }, ...(categories.data ?? []).filter((c) => c.status === 'active').map((c) => ({ value: c.id, label: c.name }))]} {...register('categoryId')} />
        <TextField label="Brand (optional)" disabled={readOnly} {...register('brand')} />
        <TextField label="MRP (optional)" inputMode="decimal" error={errors.mrp?.message} disabled={readOnly} {...register('mrp')} hint="Printed retail price, tax included" />
        <TextField label="Reorder level (optional)" inputMode="decimal" error={errors.reorderLevel?.message} disabled={readOnly} {...register('reorderLevel')} hint="Flag this item when stock falls to this quantity" />
        <TextField label="Reorder quantity (optional)" inputMode="decimal" error={errors.reorderQty?.message} disabled={readOnly} {...register('reorderQty')} hint="How much to buy when it does" />
      </div>
      {!service ? (
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Tracking" error={errors.tracking?.message} disabled={editing || readOnly} options={[{ value: 'none', label: 'None' }, { value: 'batch', label: 'By batch' }, { value: 'serial', label: 'By serial number' }]} {...register('tracking')} />
          <SelectField label="Stock valuation" disabled={readOnly} options={[{ value: 'weighted_average', label: 'Weighted average' }, { value: 'fifo', label: 'First in, first out' }]} {...register('costingMethod')} />
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        {!service ? <CheckField label="Keep stock of this item" disabled={editing || readOnly} {...register('isStocked')} /> : null}
        <CheckField label="Can be sold" disabled={readOnly} {...register('isSellable')} />
        <CheckField label="Can be bought" disabled={readOnly} {...register('isPurchasable')} />
        {!service ? <CheckField label="Made in our own factory" disabled={editing || readOnly} {...register('isManufactured')} /> : null}
        {errors.isManufactured?.message ? <p className="text-xs text-bad">{errors.isManufactured.message}</p> : null}
      </div>
      {editing ? <SelectField label="Status" disabled={readOnly} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive (hidden from new documents)' }]} {...register('status')} /> : null}
      {message ? <Alert>{message}</Alert> : null}
      {canWrite ? <Button type="submit" busy={create.isPending || update.isPending}>{editing ? 'Save changes' : 'Create item'}</Button> : null}
    </form>
  )
}
