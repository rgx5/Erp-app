import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { Party } from '@/api/schemas'
import { isValidGstin, isValidPan, normalizeGstin, panOfGstin, STATES, stateOfGstin } from '@/domain/india'
import { isValid } from '@/domain/money'
import { showApiError } from '@/features/setup/forms'
import { Alert, Button, CheckField, SelectField, TextField } from '@/ui/primitives'
import { useCreateAddress, useCreateParty, usePartyAddresses, usePaymentTerms, useUpdateParty } from './queries'

export const GST_TREATMENTS = [
  { value: 'registered_regular', label: 'Registered (regular)' }, { value: 'registered_composition', label: 'Registered (composition)' }, { value: 'unregistered', label: 'Unregistered business' },
  { value: 'consumer', label: 'Consumer (walk-in)' }, { value: 'sez', label: 'SEZ' }, { value: 'overseas', label: 'Overseas' },
] as const
const REGISTERED = new Set(['registered_regular', 'registered_composition', 'sez'])
export const treatmentLabel = (v: string): string => GST_TREATMENTS.find((t) => t.value === v)?.label ?? v
export const roleLabel = (p: Party): string => [p.isCustomer && 'Customer', p.isSupplier && 'Supplier', p.isSubcontractor && 'Subcontractor'].filter(Boolean).join(', ')

const schema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$/, 'Letters, digits and . _ / - (max 40)'),
  legalName: z.string().trim().min(1, 'Required').max(300), tradeName: z.string().max(300).optional(),
  isCustomer: z.boolean(), isSupplier: z.boolean(), isSubcontractor: z.boolean(), gstTreatment: z.string(), gstin: z.string().optional(), pan: z.string().optional(),
  paymentTermsId: z.string().optional(), creditLimit: z.string().optional(), status: z.string(),
}).superRefine((v, ctx) => {
  if (!v.isCustomer && !v.isSupplier && !v.isSubcontractor) ctx.addIssue({ code: 'custom', path: ['isCustomer'], message: 'Choose at least one role' })
  const g = normalizeGstin(v.gstin ?? '')
  if (REGISTERED.has(v.gstTreatment)) { if (!isValidGstin(g)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: g ? 'This GSTIN is not valid. Check the 15 characters.' : 'A registered party needs a GSTIN' }) }
  else if (g) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'This GST treatment has no GSTIN' })
  const pan = (v.pan ?? '').trim().toUpperCase()
  if (pan && !isValidPan(pan)) ctx.addIssue({ code: 'custom', path: ['pan'], message: 'A PAN looks like ABCDE1234F' })
  if (pan && g && isValidGstin(g) && panOfGstin(g) !== pan) ctx.addIssue({ code: 'custom', path: ['pan'], message: 'The PAN must match the one inside the GSTIN' })
  const limit = (v.creditLimit ?? '').trim()
  if (limit && !isValid(limit)) ctx.addIssue({ code: 'custom', path: ['creditLimit'], message: 'An amount with at most 4 decimals' })
  if (limit && !v.isCustomer) ctx.addIssue({ code: 'custom', path: ['creditLimit'], message: 'Only customers have a credit limit' })
})

export function PartyForm({ party, canWrite, defaultRole, onDone }: { party?: Party | undefined; canWrite: boolean; defaultRole?: 'customer' | 'supplier' | undefined; onDone: () => void }) {
  const terms = usePaymentTerms()
  const create = useCreateParty()
  const update = useUpdateParty()
  const editing = Boolean(party)
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      code: party?.code ?? '', legalName: party?.legalName ?? '', tradeName: party?.tradeName ?? '', isCustomer: party?.isCustomer ?? defaultRole !== 'supplier', isSupplier: party?.isSupplier ?? defaultRole === 'supplier',
      isSubcontractor: party?.isSubcontractor ?? false, gstTreatment: party?.gstTreatment ?? 'registered_regular', gstin: party?.gstin ?? '', pan: party?.pan ?? '', paymentTermsId: party?.paymentTermsId ?? '',
      creditLimit: party?.creditLimit && party.creditLimit !== '0.0000' ? party.creditLimit : '', status: party?.status ?? 'active',
    },
  })
  const [message, setMessage] = useState<string | null>(null)
  const treatment = watch('gstTreatment')
  const gstin = normalizeGstin(watch('gstin') ?? '')
  const registered = REGISTERED.has(treatment)
  const readOnly = !canWrite
  const fields = ['code', 'legalName', 'tradeName', 'isCustomer', 'gstTreatment', 'gstin', 'pan', 'paymentTermsId', 'creditLimit', 'status']

  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit(async (v) => {
        setMessage(null)
        try {
          if (party) {
            await update.mutateAsync({ id: party.id, version: party.version, body: { legalName: v.legalName.trim(), tradeName: v.tradeName?.trim() || null, paymentTermsId: v.paymentTermsId || null, creditLimit: v.creditLimit?.trim() || null, status: v.status as 'active' } })
          } else {
            await create.mutateAsync({
              code: v.code.trim(), legalName: v.legalName.trim(), ...(v.tradeName?.trim() ? { tradeName: v.tradeName.trim() } : {}), isCustomer: v.isCustomer, isSupplier: v.isSupplier, isSubcontractor: v.isSubcontractor,
              gstTreatment: v.gstTreatment as 'consumer', ...(registered ? { gstin: gstin } : {}), ...(v.pan?.trim() ? { pan: v.pan.trim().toUpperCase() } : {}), ...(v.paymentTermsId ? { paymentTermsId: v.paymentTermsId } : {}), ...(v.creditLimit?.trim() ? { creditLimit: v.creditLimit.trim() } : {}),
            })
          }
          onDone()
        } catch (e) { setMessage(showApiError(e, setError, fields)) }
      })}>
        {editing ? <p className="text-xs text-muted">Code, roles, GST treatment and GSTIN cannot be changed after creation.</p> : null}
        <div className="grid grid-cols-2 gap-4">
          <TextField label="Code" error={errors.code?.message} disabled={editing || readOnly} {...register('code')} />
          <SelectField label="GST treatment" options={GST_TREATMENTS} disabled={editing || readOnly} {...register('gstTreatment')} />
        </div>
        <TextField label="Legal name" error={errors.legalName?.message} disabled={readOnly} {...register('legalName')} />
        <TextField label="Trade name (optional)" disabled={readOnly} {...register('tradeName')} />
        {registered || (editing && party?.gstin) ? <TextField label="GSTIN" maxLength={15} autoCapitalize="characters" error={errors.gstin?.message} disabled={editing || readOnly} {...register('gstin')} hint={gstin.length >= 12 ? `State ${STATES.find((s) => s.code === stateOfGstin(gstin))?.name ?? '?'} · PAN ${panOfGstin(gstin)}` : undefined} /> : null}
        <div className="flex flex-wrap gap-5">
          <CheckField label="Customer" disabled={editing || readOnly} {...register('isCustomer')} />
          <CheckField label="Supplier" disabled={editing || readOnly} {...register('isSupplier')} />
          <CheckField label="Subcontractor" disabled={editing || readOnly} {...register('isSubcontractor')} />
        </div>
        {errors.isCustomer?.message ? <p className="text-xs text-bad">{errors.isCustomer.message}</p> : null}
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Payment terms" disabled={readOnly} options={[{ value: '', label: 'None' }, ...(terms.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.netDays} days)` }))]} {...register('paymentTermsId')} />
          <TextField label="Credit limit (customers)" inputMode="decimal" error={errors.creditLimit?.message} disabled={readOnly} {...register('creditLimit')} />
        </div>
        {!registered && !editing ? <TextField label="PAN (optional)" maxLength={10} error={errors.pan?.message} {...register('pan')} /> : null}
        {editing ? <SelectField label="Status" disabled={readOnly} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'blocked', label: 'Blocked (no new documents)' }]} {...register('status')} /> : null}
        {message ? <Alert>{message}</Alert> : null}
        {canWrite ? <Button type="submit" busy={create.isPending || update.isPending}>{editing ? 'Save changes' : 'Create party'}</Button> : null}
      </form>
      {party ? <Addresses partyId={party.id} canWrite={canWrite} defaultState={party.gstin ? stateOfGstin(party.gstin) : '27'} /> : null}
    </div>
  )
}

const addressSchema = z.object({ kind: z.string(), line1: z.string().trim().min(1, 'Required').max(200), line2: z.string().max(200).optional(), city: z.string().trim().min(1, 'Required').max(100), stateCode: z.string(), pincode: z.string().regex(/^[1-9][0-9]{5}$/, 'A pincode has 6 digits'), isDefault: z.boolean() })

function Addresses({ partyId, canWrite, defaultState }: { partyId: string; canWrite: boolean; defaultState: string }) {
  const list = usePartyAddresses(partyId)
  const add = useCreateAddress(partyId)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const { register, handleSubmit, reset, setError, formState: { errors } } = useForm({ resolver: zodResolver(addressSchema), defaultValues: { kind: 'billing', line1: '', line2: '', city: '', stateCode: defaultState, pincode: '', isDefault: false } })
  return (
    <section aria-label="Addresses" className="flex flex-col gap-3 border-t border-line pt-4">
      <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Addresses</h3>{canWrite && !open ? <Button variant="secondary" onClick={() => setOpen(true)}>Add address</Button> : null}</div>
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.data && list.data.length === 0 && !open ? <p className="text-sm text-muted">No address yet. Invoices need a billing address to work out the place of supply.</p> : null}
      <ul className="flex flex-col gap-2">
        {(list.data ?? []).map((a) => (
          <li key={a.id} className="rounded-md border border-line px-3 py-2 text-sm">
            <span className="font-medium capitalize">{a.kind}</span>{a.isDefault ? <span className="ml-2 text-xs text-muted">default</span> : null}
            <p className="text-muted">{[a.line1, a.line2, a.city, STATES.find((s) => s.code === a.stateCode)?.name ?? a.stateCode, a.pincode].filter(Boolean).join(', ')}</p>
          </li>
        ))}
      </ul>
      {open ? (
        <form className="flex flex-col gap-3 rounded-md border border-line p-3" onSubmit={handleSubmit(async (v) => {
          setMessage(null)
          try { await add.mutateAsync({ kind: v.kind as 'billing', line1: v.line1.trim(), ...(v.line2?.trim() ? { line2: v.line2.trim() } : {}), city: v.city.trim(), stateCode: v.stateCode, pincode: v.pincode, country: 'IN', isDefault: v.isDefault }); reset(); setOpen(false) }
          catch (e) { setMessage(showApiError(e, setError, ['kind', 'line1', 'line2', 'city', 'stateCode', 'pincode'])) }
        })}>
          <SelectField label="Kind" options={[{ value: 'billing', label: 'Billing' }, { value: 'shipping', label: 'Shipping' }, { value: 'registered', label: 'Registered office' }, { value: 'other', label: 'Other' }]} {...register('kind')} />
          <TextField label="Address" error={errors.line1?.message} {...register('line1')} />
          <TextField label="Address line 2 (optional)" {...register('line2')} />
          <div className="grid grid-cols-3 gap-3">
            <TextField label="City" error={errors.city?.message} {...register('city')} />
            <SelectField label="State" options={STATES.map((s) => ({ value: s.code, label: s.name }))} {...register('stateCode')} />
            <TextField label="Pincode" maxLength={6} error={errors.pincode?.message} {...register('pincode')} />
          </div>
          <CheckField label="Use as the default of its kind" {...register('isDefault')} />
          {message ? <Alert>{message}</Alert> : null}
          <div className="flex gap-2"><Button type="submit" busy={add.isPending}>Save address</Button><Button type="button" variant="ghost" onClick={() => { reset(); setOpen(false) }}>Cancel</Button></div>
        </form>
      ) : null}
    </section>
  )
}
