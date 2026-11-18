import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { z } from 'zod'
import type { ItemCategory } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { useCategories, useCreateCategory, useUpdateCategory } from '@/features/masterdata/queries'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, CheckField, SelectField, Spinner, TextField } from '@/ui/primitives'

export function CategoriesPage() {
  const canWrite = can(useSession((s) => s.me?.permissions ?? []), 'masterdata:write')
  const list = useCategories()
  const create = useCreateCategory(); const update = useUpdateCategory()
  const flash = useFlash()
  const [editing, setEditing] = useState<ItemCategory | 'new' | null>(null)
  const ordered = useMemo(() => {
    const rows = list.data ?? []
    const out: { c: ItemCategory; depth: number }[] = []
    const walk = (parent: string | null, depth: number): void => { for (const c of rows.filter((x) => x.parentId === parent).sort((a, b) => a.name.localeCompare(b.name))) { out.push({ c, depth }); if (depth < 10) walk(c.id, depth + 1) } }
    walk(null, 0)
    return out
  }, [list.data])
  const cat = editing && editing !== 'new' ? editing : null
  const schema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,29}$/, 'Letters, digits and . _ / -'), name: z.string().trim().min(1, 'Required').max(100), parentId: z.string(), noDiscount: z.boolean(), status: z.string() })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">Item categories</h1>{canWrite ? <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> New category</Button> : null}</div>
      <p className="max-w-3xl text-sm text-muted">Group items (for example Grocery, then Staples under it). A category can forbid discounts: the counter then refuses a discount on every item in it, and in the categories below it.</p>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : ordered.length === 0 ? <Alert tone="info">No categories yet.</Alert> : (
        <table className="w-full max-w-3xl text-sm" aria-label="Categories"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Name</th><th className="py-1">Code</th><th className="py-1">Discounts</th><th className="py-1">Status</th></tr></thead>
          <tbody>{ordered.map(({ c, depth }) => <tr key={c.id} className="cursor-pointer border-t border-line/60 hover:bg-brand-soft/60" onClick={() => canWrite && setEditing(c)}><td className="py-2" style={{ paddingLeft: depth * 20 }}>{c.name}</td><td className="py-2 text-muted">{c.code}</td><td className="py-2">{c.noDiscount ? 'Not allowed' : 'Allowed'}</td><td className="py-2">{c.status}</td></tr>)}</tbody></table>)}
      {editing ? (
        <Drawer title={cat ? cat.name : 'New category'} onClose={() => setEditing(null)}>
          <SimpleForm schema={schema} defaults={{ code: cat?.code ?? '', name: cat?.name ?? '', parentId: cat?.parentId ?? '', noDiscount: cat?.noDiscount ?? false, status: cat?.status ?? 'active' }} fields={['code', 'name', 'parentId', 'noDiscount', 'status']} label={cat ? 'Save' : 'Create'}
            submit={async (v) => {
              if (cat) await update.mutateAsync({ id: cat.id, version: cat.version, body: { name: v.name, parentId: v.parentId || null, noDiscount: v.noDiscount, status: v.status as 'active' } })
              else await create.mutateAsync({ code: v.code, name: v.name, ...(v.parentId ? { parentId: v.parentId } : {}), noDiscount: v.noDiscount })
              flash.show(cat ? 'Category saved.' : 'Category created.'); setEditing(null)
            }}>
            {({ register, errors }) => (<>
              <TextField label="Code" disabled={Boolean(cat)} error={errors.code?.message as string | undefined} {...register('code')} /><TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} />
              <SelectField label="Inside" options={[{ value: '', label: 'Top level' }, ...(list.data ?? []).filter((c) => c.id !== cat?.id).map((c) => ({ value: c.id, label: c.name }))]} {...register('parentId')} />
              <CheckField label="No discount on items in this category" {...register('noDiscount')} />
              {cat ? <SelectField label="Status" options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} {...register('status')} /> : null}
            </>)}
          </SimpleForm>
        </Drawer>) : null}
    </div>
  )
}
