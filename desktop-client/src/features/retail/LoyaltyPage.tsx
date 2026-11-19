import { Plus } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { ApiError } from '@/api/errors'
import type { Coupon } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate, formatInr, todayIso } from '@/domain/format'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { useCoupons, useCreateCoupon, useRetailSettings, useSaveRetailSettings, useUpdateCoupon } from './queries'

const msg = (e: unknown, f: string): string => (e instanceof ApiError ? `${e.message}${e.requestId ? ` (reference ${e.requestId})` : ''}` : f)
const rate = z.string().regex(/^\d{1,6}(\.\d{1,4})?$/, 'A number such as 1 or 0.5')

function Rates({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const s = useRetailSettings(companyId)
  const save = useSaveRetailSettings(companyId)
  const flash = useFlash()
  const [per, setPer] = useState<string | null>(null)
  const [worth, setWorth] = useState<string | null>(null)
  const [limit, setLimit] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  if (s.isPending) return <Spinner />
  const a = per ?? String(Number(s.data?.loyaltyPointsPerHundred ?? 0)); const b = worth ?? String(Number(s.data?.loyaltyRupeesPerPoint ?? 0))
  const l = limit ?? (s.data?.maxDiscountWithoutApproval != null ? String(Number(s.data.maxDiscountWithoutApproval)) : '')
  return (
    <Card title="Loyalty points and discount limit">
      <div className="flex max-w-xl flex-col gap-3">
        <p className="text-sm text-muted">Named customers earn points on what they pay. Walk-in sales earn nothing. Leave both at 0 to switch loyalty off. How much a point costs you is a question for your accountant.</p>
        <div className="grid grid-cols-2 gap-4"><TextField label="Points earned per ₹100 spent" inputMode="decimal" value={a} disabled={!canManage} onChange={(e) => setPer(e.target.value)} /><TextField label="Value of one point (₹)" inputMode="decimal" value={b} disabled={!canManage} onChange={(e) => setWorth(e.target.value)} /></div>
        <TextField label="Largest discount a cashier may give without a manager's PIN (%)" inputMode="decimal" value={l} disabled={!canManage} hint="Leave empty for no limit. Managers set their PIN under My account." onChange={(e) => setLimit(e.target.value)} error={l !== '' && !/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/.test(l) ? 'A percentage from 0 to 100' : undefined} />
        {problem ? <Alert>{problem}</Alert> : null}
        {canManage ? <Button className="self-start" disabled={!rate.safeParse(a).success || !rate.safeParse(b).success || (l !== '' && !/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/.test(l))} onClick={async () => { setProblem(null); try { await save.mutateAsync({ loyaltyPointsPerHundred: a, loyaltyRupeesPerPoint: b, maxDiscountWithoutApproval: l === '' ? null : l }); flash.show('Loyalty rates saved.'); setPer(null); setWorth(null); setLimit(null) } catch (e) { setProblem(msg(e, 'Could not save.')) } }}>Save rates</Button> : null}
      </div>
    </Card>
  )
}

function NewCoupon({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const create = useCreateCoupon()
  const flash = useFlash()
  const [problem, setProblem] = useState<string | null>(null)
  const money = z.string().regex(/^\d{1,14}(\.\d{1,4})?$/, 'An amount such as 100')
  const schema = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$/, '3 to 30 letters, digits, - or _'), kind: z.enum(['percent', 'fixed']), value: money.refine((v) => Number(v) > 0, 'Must be above zero'), minBill: z.string().trim(), maxDiscount: z.string().trim(), validFrom: z.string(), validTo: z.string(), maxUses: z.string().trim(), description: z.string().trim().max(200) })
  return (
    <Drawer title="New coupon" onClose={onClose}>
      <SimpleForm schema={schema} defaults={{ code: '', kind: 'percent', value: '', minBill: '', maxDiscount: '', validFrom: todayIso(), validTo: '', maxUses: '', description: '' }} fields={['code', 'kind', 'value', 'minBill', 'maxDiscount', 'validFrom', 'validTo', 'maxUses', 'description']} label="Create coupon"
        submit={async (v) => {
          setProblem(null)
          if (v.kind === 'percent' && Number(v.value) > 100) { setProblem('A percentage cannot exceed 100.'); return }
          for (const x of [v.minBill, v.maxDiscount]) if (x && !money.safeParse(x).success) { setProblem('Amounts must be numbers such as 500.'); return }
          if (v.maxUses && !/^\d+$/.test(v.maxUses)) { setProblem('Uses must be a whole number.'); return }
          try { const r = await create.mutateAsync({ key: crypto.randomUUID(), body: { companyId, code: v.code, kind: v.kind, value: v.value, ...(v.minBill ? { minBill: v.minBill } : {}), ...(v.maxDiscount ? { maxDiscount: v.maxDiscount } : {}), ...(v.validFrom ? { validFrom: v.validFrom } : {}), ...(v.validTo ? { validTo: v.validTo } : {}), ...(v.maxUses ? { maxUses: Number(v.maxUses) } : {}), ...(v.description ? { description: v.description } : {}) } }); flash.show(`Coupon ${r.code} created.`); onClose() } catch (e) { setProblem(msg(e, 'Could not create the coupon.')) }
        }}>
        {({ register, errors }) => (<>
          <TextField label="Code the cashier types" error={errors.code?.message as string | undefined} {...register('code')} />
          <SelectField label="Gives" options={[{ value: 'percent', label: 'A percentage off' }, { value: 'fixed', label: 'A fixed amount off' }]} {...register('kind')} />
          <TextField label="Value (% or ₹)" inputMode="decimal" error={errors.value?.message as string | undefined} {...register('value')} />
          <TextField label="Minimum bill (optional)" inputMode="decimal" {...register('minBill')} />
          <TextField label="Largest discount (optional)" inputMode="decimal" {...register('maxDiscount')} />
          <div className="grid grid-cols-2 gap-4"><TextField label="Valid from" type="date" {...register('validFrom')} /><TextField label="Valid until (optional)" type="date" {...register('validTo')} /></div>
          <TextField label="Times it can be used (optional)" inputMode="numeric" {...register('maxUses')} />
          <TextField label="Note (optional)" {...register('description')} />
          {problem ? <Alert>{problem}</Alert> : null}
        </>)}
      </SimpleForm>
    </Drawer>
  )
}

const offer = (c: Coupon): string => `${c.kind === 'percent' ? `${Number(c.value)}% off` : `${formatInr(c.value)} off`}${Number(c.minBill) > 0 ? ` over ${formatInr(c.minBill)}` : ''}${c.maxDiscount ? `, up to ${formatInr(c.maxDiscount)}` : ''}`

export function LoyaltyPage() {
  const ws = useWorkspace()
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'retail:manage')
  const list = useCoupons(ws.company?.id)
  const update = useUpdateCoupon()
  const [adding, setAdding] = useState(false)
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Loyalty and coupons</h1>
      <Rates companyId={ws.company.id} canManage={canManage} />
      <Card title="Coupons">
        <div className="flex flex-col gap-3">
          {canManage ? <Button className="self-start" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> New coupon</Button> : null}
          {list.isPending ? <Spinner /> : list.rows.length === 0 ? <Alert tone="info">No coupons yet.</Alert> : (
            <table className="w-full text-sm" aria-label="Coupons"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Code</th><th className="py-1">Offer</th><th className="py-1">Valid</th><th className="py-1 text-right">Used</th><th className="py-1">Status</th><th /></tr></thead>
              <tbody>{list.rows.map((c) => <tr key={c.id} className="border-t border-line/60"><td className="py-1.5 font-medium">{c.code}</td><td className="py-1.5">{offer(c)}</td><td className="py-1.5 text-muted">{c.validFrom ? formatDate(c.validFrom) : 'Any time'}{c.validTo ? ` to ${formatDate(c.validTo)}` : ''}</td><td className="num py-1.5 text-right">{c.usedCount}{c.maxUses ? ` of ${c.maxUses}` : ''}</td><td className="py-1.5">{c.status === 'active' ? 'Active' : 'Off'}</td>
                <td className="py-1.5 text-right">{canManage ? <Button variant="ghost" aria-label={`${c.status === 'active' ? 'Switch off' : 'Switch on'} ${c.code}`} onClick={() => void update.mutateAsync({ id: c.id, version: c.version, body: { status: c.status === 'active' ? 'inactive' : 'active' } })}>{c.status === 'active' ? 'Switch off' : 'Switch on'}</Button> : null}</td></tr>)}</tbody></table>)}
        </div>
      </Card>
      {adding ? <NewCoupon companyId={ws.company.id} onClose={() => setAdding(false)} /> : null}
    </div>
  )
}
