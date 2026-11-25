import { z } from 'zod'
import { address as addressSchema } from '@/api/schemas'
import { currentApi } from '@/auth/session'
import { isValidGstin, normalizeGstin, STATES } from '@/domain/india'
import { codeFromName } from '@/features/import/mapping'
import { GST_TREATMENTS } from '@/features/masterdata/PartyForm'
import { createPartyRequest } from '@/features/masterdata/queries'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, SelectField, TextField } from '@/ui/primitives'
import { useLeadActions, type Lead } from './queries'

const REGISTERED = new Set(['registered_regular', 'registered_composition', 'sez'])
const schema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$/, 'Letters, digits and . _ / - (max 40)'), legalName: z.string().trim().min(1, 'Required').max(300), gstTreatment: z.string(), gstin: z.string().trim(),
  line1: z.string().trim().min(1, 'The address is needed on invoices').max(200), city: z.string().trim().min(1, 'Required').max(100), stateCode: z.string().regex(/^[0-9]{2}$/, 'Choose the state'), pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'A 6-digit PIN code'),
}).superRefine((v, ctx) => {
  const g = normalizeGstin(v.gstin)
  if (REGISTERED.has(v.gstTreatment) && !g) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'A registered customer needs a GSTIN' })
  if (g && !isValidGstin(g)) ctx.addIssue({ code: 'custom', path: ['gstin'], message: 'This GSTIN is not valid' })
  if (!REGISTERED.has(v.gstTreatment) && g) ctx.addIssue({ code: 'custom', path: ['gstTreatment'], message: 'Choose a registered treatment for a customer with a GSTIN' })
})

/** Turns a lead into a customer: the same details a customer needs for invoicing, filled in from the lead where known. */
export function ConvertDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const a = useLeadActions(); const flash = useFlash()
  const state = STATES.find((s) => lead.state && s.name.toLowerCase() === lead.state.toLowerCase())?.code ?? ''
  return (
    <Drawer title={`Make ${lead.name} a customer`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Alert tone="info">This creates the customer you will invoice. The lead keeps its history and is linked to them, so sales can be traced back to the advert.</Alert>
        <SimpleForm schema={schema} defaults={{ code: codeFromName(lead.name, new Set()), legalName: lead.name, gstTreatment: 'consumer', gstin: '', line1: '', city: lead.city ?? '', stateCode: state, pincode: lead.pincode ?? '' }} fields={['code', 'legalName', 'gstin']} label="Create customer"
          submit={async (v) => {
            const gstin = normalizeGstin(v.gstin)
            const party = await createPartyRequest({ code: v.code, legalName: v.legalName, isCustomer: true, isSupplier: false, isSubcontractor: false, gstTreatment: v.gstTreatment as 'consumer', ...(gstin ? { gstin } : {}), ...(lead.phone ? { phone: lead.phone } : {}), ...(lead.email ? { email: lead.email } : {}) } as never)
            const api = currentApi()
            await api.call(api.raw.POST('/v1/parties/{id}/addresses', { params: { path: { id: party.id } }, body: { kind: 'billing', line1: v.line1, city: v.city, stateCode: v.stateCode, pincode: v.pincode, isDefault: true } as never }), addressSchema)
            await a.link.mutateAsync({ id: lead.id, partyId: party.id })
            flash.show(`${v.legalName} is now a customer.`); onClose()
          }}>
          {({ register, errors }) => (<>
            <div className="grid grid-cols-2 gap-3"><TextField label="Customer code" error={errors.code?.message as string | undefined} {...register('code')} /><TextField label="Name" error={errors.legalName?.message as string | undefined} {...register('legalName')} /></div>
            <div className="grid grid-cols-2 gap-3"><SelectField label="GST treatment" options={GST_TREATMENTS.filter((t) => t.value !== 'overseas')} error={errors.gstTreatment?.message as string | undefined} {...register('gstTreatment')} /><TextField label="GSTIN (if registered)" error={errors.gstin?.message as string | undefined} {...register('gstin')} /></div>
            <TextField label="Billing address" error={errors.line1?.message as string | undefined} {...register('line1')} />
            <div className="grid grid-cols-3 gap-3"><TextField label="City" error={errors.city?.message as string | undefined} {...register('city')} /><SelectField label="State" options={[{ value: '', label: 'Choose…' }, ...STATES.map((s) => ({ value: s.code, label: s.name }))]} error={errors.stateCode?.message as string | undefined} {...register('stateCode')} /><TextField label="PIN code" error={errors.pincode?.message as string | undefined} {...register('pincode')} /></div>
          </>)}
        </SimpleForm>
      </div>
    </Drawer>
  )
}
