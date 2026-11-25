import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, SelectField, TextField } from '@/ui/primitives'
import { LeadError, SOURCES, useLeadActions, type Lead } from './queries'

const schema = z.object({
  name: z.string().trim().min(1, 'Required').max(200), phone: z.string().trim().max(30), email: z.string().trim().max(254), city: z.string().trim().max(100), pincode: z.string().trim().max(12),
  source: z.string(), campaign: z.string().trim().max(200), interest: z.string().trim().max(200), monthlyBill: z.string().trim().max(20),
}).refine((v) => v.phone !== '' || v.email !== '', { path: ['phone'], message: 'Give a phone number or an email' })

/** A lead added by hand: a call, a walk-in, a referral. If the same person is already a lead it says so and offers to add anyway. */
export function NewLeadDrawer({ onClose }: { onClose: () => void }) {
  const a = useLeadActions(); const flash = useFlash(); const navigate = useNavigate()
  const [duplicate, setDuplicate] = useState<Lead | null>(null); const [pending, setPending] = useState<z.infer<typeof schema> | null>(null)
  async function save(v: z.infer<typeof schema>, allowDuplicate: boolean) {
    const body = { name: v.name, ...(v.phone ? { phone: v.phone } : {}), ...(v.email ? { email: v.email } : {}), ...(v.city ? { city: v.city } : {}), ...(v.pincode ? { pincode: v.pincode } : {}), source: v.source, ...(v.campaign ? { campaign: v.campaign } : {}), ...(v.interest ? { interest: v.interest } : {}), ...(v.monthlyBill ? { fields: { monthly_bill: v.monthlyBill } } : {}), allowDuplicate }
    try { const lead = await a.create.mutateAsync(body); flash.show(`${lead.leadNo} added.`); onClose(); await navigate({ to: '/leads/$leadId', params: { leadId: lead.id } }) }
    catch (e) { if (e instanceof LeadError && e.extra['code'] === 'duplicate_lead') { setDuplicate(e.extra['lead'] as Lead); setPending(v); return } throw e }
  }
  return (
    <Drawer title="New lead" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {duplicate && pending ? (
          <Alert tone="info">
            <p><b>{duplicate.name}</b> ({duplicate.leadNo}) is already an open lead with this phone or email.</p>
            <div className="mt-2 flex gap-2">
              <Button variant="secondary" onClick={() => { onClose(); void navigate({ to: '/leads/$leadId', params: { leadId: duplicate.id } }) }}>Open that lead</Button>
              <Button variant="secondary" onClick={() => void save(pending, true).catch(() => undefined)}>Add anyway</Button>
            </div>
          </Alert>
        ) : null}
        <SimpleForm schema={schema} defaults={{ name: '', phone: '', email: '', city: '', pincode: '', source: 'phone', campaign: '', interest: '', monthlyBill: '' }} fields={['name', 'phone', 'email', 'city']} label="Add lead" submit={(v) => save(v, false)}>
          {({ register, errors }) => (<>
            <TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} />
            <div className="grid grid-cols-2 gap-3"><TextField label="Phone" inputMode="tel" error={errors.phone?.message as string | undefined} {...register('phone')} /><TextField label="Email" error={errors.email?.message as string | undefined} {...register('email')} /></div>
            <div className="grid grid-cols-2 gap-3"><TextField label="City" {...register('city')} /><TextField label="PIN code" inputMode="numeric" {...register('pincode')} /></div>
            <div className="grid grid-cols-2 gap-3"><SelectField label="Where did it come from?" options={SOURCES.filter((s) => !['import'].includes(s.value))} {...register('source')} /><TextField label="Campaign (optional)" {...register('campaign')} /></div>
            <TextField label="Interested in (optional)" placeholder="e.g. 5 kW rooftop solar" {...register('interest')} />
            <TextField label="Monthly electricity bill, ₹ (optional)" inputMode="numeric" {...register('monthlyBill')} />
          </>)}
        </SimpleForm>
      </div>
    </Drawer>
  )
}
