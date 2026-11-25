import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from '@tanstack/react-router'
import { Check, Circle } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { Company, GstRegistration } from '@/api/schemas'
import { financialYearStart, isValidGstin, isValidPan, isValidPincode, normalizeGstin, panOfGstin, STATES, stateOfGstin } from '@/domain/india'
import { todayIso } from '@/domain/format'
import { useCompanies } from '@/features/organization/queries'
import { Alert, Button, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { showApiError } from './forms'
import { useApplyDefaults, useCreateCompany, useCreateFiscalYear, useCreateLocation, useCreateRegistration, useCreateWarehouse, useFiscalYears, useGstRegistrations, useLocations, useSetupStatus, useWarehouses } from './queries'

const REGISTRATION_TYPES = [
  { value: 'regular', label: 'Regular' }, { value: 'composition', label: 'Composition' }, { value: 'sez_unit', label: 'SEZ unit' }, { value: 'sez_developer', label: 'SEZ developer' },
  { value: 'casual', label: 'Casual taxable person' }, { value: 'non_resident', label: 'Non-resident' }, { value: 'isd', label: 'Input service distributor' },
]
const WAREHOUSE_KINDS = [
  { value: 'finished_goods', label: 'Finished goods' }, { value: 'general', label: 'General' }, { value: 'raw_material', label: 'Raw material' },
  { value: 'work_in_progress', label: 'Work in progress' }, { value: 'scrap', label: 'Scrap' },
]
const optional = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined)

type StepKey = 'company' | 'gst' | 'location' | 'warehouse' | 'year' | 'defaults'
const STEPS: { key: StepKey; label: string }[] = [
  { key: 'company', label: 'Your company' }, { key: 'gst', label: 'GST registration' }, { key: 'location', label: 'Place of business' },
  { key: 'warehouse', label: 'Warehouse' }, { key: 'year', label: 'Financial year' }, { key: 'defaults', label: 'Standard setup' },
]

// ---- step forms -------------------------------------------------------------------------------------------------------
const companySchema = z.object({ legalName: z.string().trim().min(1, 'Required').max(300), tradeName: z.string().max(300).optional(), pan: z.string().optional().refine((v) => !v || isValidPan(v.trim().toUpperCase()), 'A PAN looks like ABCDE1234F'), fiscalYearStartMonth: z.string() })
function CompanyStep() {
  const create = useCreateCompany()
  const { register, handleSubmit, setError, formState: { errors } } = useForm({ resolver: zodResolver(companySchema), defaultValues: { legalName: '', tradeName: '', pan: '', fiscalYearStartMonth: '4' } })
  const [message, setMessage] = useState<string | null>(null)
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(async (v) => {
      setMessage(null)
      try { await create.mutateAsync({ legalName: v.legalName.trim(), ...(optional(v.tradeName) ? { tradeName: optional(v.tradeName) as string } : {}), ...(optional(v.pan) ? { pan: v.pan?.trim().toUpperCase() as string } : {}), fiscalYearStartMonth: Number(v.fiscalYearStartMonth) }) }
      catch (e) { setMessage(showApiError(e, setError, ['legalName', 'tradeName', 'pan'])) }
    })}>
      <TextField label="Legal name" autoFocus error={errors.legalName?.message} {...register('legalName')} hint="As on your GST certificate." />
      <TextField label="Trade name (optional)" error={errors.tradeName?.message} {...register('tradeName')} />
      <TextField label="PAN (optional)" error={errors.pan?.message} {...register('pan')} maxLength={10} />
      <SelectField label="Financial year starts in" options={['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => ({ value: String(i + 1), label: m }))} {...register('fiscalYearStartMonth')} />
      {message ? <Alert>{message}</Alert> : null}
      <Button type="submit" busy={create.isPending}>Create company</Button>
    </form>
  )
}

function GstStep({ company }: { company: Company }) {
  const create = useCreateRegistration(company.id)
  const schema = z.object({
    gstin: z.string().refine((v) => isValidGstin(normalizeGstin(v)), 'This GSTIN is not valid. Check the 15 characters.'),
    legalName: z.string().trim().min(1, 'Required').max(300), tradeName: z.string().max(300).optional(), registrationType: z.string(), effectiveFrom: z.string().min(1, 'Required'),
  })
  const { register, handleSubmit, setError, watch, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: { gstin: '', legalName: company.legalName, tradeName: company.tradeName ?? '', registrationType: 'regular', effectiveFrom: financialYearStart(todayIso(), company.fiscalYearStartMonth) } })
  const [message, setMessage] = useState<string | null>(null)
  const gstin = normalizeGstin(watch('gstin'))
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(async (v) => {
      setMessage(null)
      try { await create.mutateAsync({ gstin: normalizeGstin(v.gstin), legalName: v.legalName.trim(), ...(optional(v.tradeName) ? { tradeName: optional(v.tradeName) as string } : {}), registrationType: v.registrationType as 'regular', effectiveFrom: v.effectiveFrom }) }
      catch (e) { setMessage(showApiError(e, setError, ['gstin', 'legalName', 'tradeName', 'effectiveFrom'])) }
    })}>
      <TextField label="GSTIN" autoFocus autoCapitalize="characters" maxLength={15} error={errors.gstin?.message} {...register('gstin')} hint={gstin.length >= 12 ? `State ${STATES.find((s) => s.code === stateOfGstin(gstin))?.name ?? '?'} · PAN ${panOfGstin(gstin)}` : '15 characters, for example 27ABCDE1234F1Z5'} />
      <TextField label="Registered name" error={errors.legalName?.message} {...register('legalName')} />
      <TextField label="Trade name (optional)" {...register('tradeName')} />
      <SelectField label="Registration type" options={REGISTRATION_TYPES} {...register('registrationType')} />
      <TextField label="Registered since" type="date" error={errors.effectiveFrom?.message} {...register('effectiveFrom')} />
      {message ? <Alert>{message}</Alert> : null}
      <Button type="submit" busy={create.isPending}>Save GST registration</Button>
    </form>
  )
}

function LocationStep({ company, registration }: { company: Company; registration: GstRegistration }) {
  const create = useCreateLocation()
  const schema = z.object({
    code: z.string().trim().min(1, 'Required').max(32), name: z.string().trim().min(1, 'Required').max(200), addressLine1: z.string().trim().min(1, 'Required').max(200), addressLine2: z.string().max(200).optional(),
    city: z.string().trim().min(1, 'Required').max(100), stateCode: z.string(), pincode: z.string().refine(isValidPincode, 'A pincode has 6 digits'),
  })
  const { register, handleSubmit, setError, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: { code: 'MAIN', name: 'Head office', addressLine1: '', addressLine2: '', city: '', stateCode: registration.stateCode, pincode: '' } })
  const [message, setMessage] = useState<string | null>(null)
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(async (v) => {
      setMessage(null)
      try { await create.mutateAsync({ companyId: company.id, gstRegistrationId: registration.id, code: v.code.trim(), name: v.name.trim(), isPrincipalPlace: true, addressLine1: v.addressLine1.trim(), ...(optional(v.addressLine2) ? { addressLine2: optional(v.addressLine2) as string } : {}), city: v.city.trim(), stateCode: v.stateCode, pincode: v.pincode }) }
      catch (e) { setMessage(showApiError(e, setError, ['code', 'name', 'addressLine1', 'addressLine2', 'city', 'stateCode', 'pincode'])) }
    })}>
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Code" error={errors.code?.message} {...register('code')} />
        <TextField label="Name" error={errors.name?.message} {...register('name')} />
      </div>
      <TextField label="Address" autoFocus error={errors.addressLine1?.message} {...register('addressLine1')} />
      <TextField label="Address line 2 (optional)" {...register('addressLine2')} />
      <div className="grid grid-cols-3 gap-4">
        <TextField label="City" error={errors.city?.message} {...register('city')} />
        <SelectField label="State" options={STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))} {...register('stateCode')} />
        <TextField label="Pincode" inputMode="numeric" maxLength={6} error={errors.pincode?.message} {...register('pincode')} />
      </div>
      {message ? <Alert>{message}</Alert> : null}
      <Button type="submit" busy={create.isPending}>Save place of business</Button>
    </form>
  )
}

function WarehouseStep({ locationId }: { locationId: string }) {
  const create = useCreateWarehouse()
  const schema = z.object({ code: z.string().trim().min(1, 'Required').max(32), name: z.string().trim().min(1, 'Required').max(200), kind: z.string() })
  const { register, handleSubmit, setError, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: { code: 'MAIN', name: 'Main warehouse', kind: 'finished_goods' } })
  const [message, setMessage] = useState<string | null>(null)
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(async (v) => {
      setMessage(null)
      try { await create.mutateAsync({ businessLocationId: locationId, code: v.code.trim(), name: v.name.trim(), kind: v.kind as 'general' }) }
      catch (e) { setMessage(showApiError(e, setError, ['code', 'name', 'kind'])) }
    })}>
      <div className="grid grid-cols-2 gap-4">
        <TextField label="Code" autoFocus error={errors.code?.message} {...register('code')} />
        <TextField label="Name" error={errors.name?.message} {...register('name')} />
      </div>
      <SelectField label="What it holds" options={WAREHOUSE_KINDS} {...register('kind')} />
      {message ? <Alert>{message}</Alert> : null}
      <Button type="submit" busy={create.isPending}>Save warehouse</Button>
    </form>
  )
}

function YearStep({ company }: { company: Company }) {
  const create = useCreateFiscalYear()
  const schema = z.object({ startDate: z.string().min(1, 'Required') })
  const { register, handleSubmit, setError, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: { startDate: financialYearStart(todayIso(), company.fiscalYearStartMonth) } })
  const [message, setMessage] = useState<string | null>(null)
  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit(async (v) => {
      setMessage(null)
      try { await create.mutateAsync({ companyId: company.id, startDate: v.startDate }) }
      catch (e) { setMessage(showApiError(e, setError, ['startDate'])) }
    })}>
      <TextField label="First day of the financial year" type="date" autoFocus error={errors.startDate?.message} {...register('startDate')} hint="The year runs for twelve months from this day. Books can be posted only inside an open year." />
      {message ? <Alert>{message}</Alert> : null}
      <Button type="submit" busy={create.isPending}>Open financial year</Button>
    </form>
  )
}

function DefaultsStep({ company, registrations }: { company: Company; registrations: GstRegistration[] }) {
  const status = useSetupStatus(company.id)
  const apply = useApplyDefaults(company.id)
  const [message, setMessage] = useState<string | null>(null)
  const result = apply.data
  const checks = (result?.status ?? status.data)?.checks ?? []
  const ready = (result?.status ?? status.data)?.ready ?? false
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">One click adds the standard Indian setup: chart of accounts, financial statement mapping, stock, sales and purchase accounts, invoice numbering for {registrations.length === 1 ? 'your GST registration' : 'each GST registration'}, and the GST slabs. Anything you have already set is left alone.</p>
      {status.isPending ? <Spinner /> : null}
      <ul className="flex flex-col gap-1.5">
        {checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-sm">
            {c.done ? <Check className="mt-0.5 size-4 text-good" aria-label="Done" /> : <Circle className="mt-0.5 size-4 text-muted" aria-label="Not done" />}
            <span><span className="font-medium">{c.label}</span> <span className="text-muted">· {c.detail}</span></span>
          </li>
        ))}
      </ul>
      {result?.steps.some((s) => s.action === 'blocked') ? <Alert>{result.steps.filter((s) => s.action === 'blocked').map((s) => s.detail).join(' ')}</Alert> : null}
      {message ? <Alert>{message}</Alert> : null}
      {ready ? (
        <div className="flex flex-col gap-3">
          <Alert tone="info">Setup is complete. You can raise invoices and receive stock.</Alert>
          <Link to="/" className="inline-flex h-9 items-center justify-center rounded-md bg-brand px-3.5 text-sm font-medium text-brand-ink">Go to the dashboard</Link>
        </div>
      ) : (
        <Button busy={apply.isPending} onClick={async () => { setMessage(null); try { await apply.mutateAsync(undefined) } catch (e) { setMessage(showApiError(e, () => undefined, []) ?? 'Setup failed.') } }}>Apply standard setup</Button>
      )}
    </div>
  )
}

// ---- the page ---------------------------------------------------------------------------------------------------------
export function SetupPage() {
  const companies = useCompanies()
  const company = companies.data?.[0]
  const regs = useGstRegistrations(company?.id)
  const locations = useLocations(company?.id)
  const warehouses = useWarehouses(company?.id, (locations.data ?? []).map((l) => l.id))
  const years = useFiscalYears(company?.id)
  const loading = companies.isPending || (company && (regs.isPending || locations.isPending || years.isPending || (locations.data?.length && warehouses.isPending)))
  if (companies.error) return <Alert>{companies.error.message}</Alert>
  if (loading) return <Spinner />

  const registration = regs.data?.[0]
  const location = locations.data?.[0]
  const current: StepKey = !company ? 'company' : !registration ? 'gst' : !location ? 'location' : (warehouses.data?.length ?? 0) === 0 ? 'warehouse' : (years.data?.length ?? 0) === 0 ? 'year' : 'defaults'
  const index = STEPS.findIndex((s) => s.key === current)

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="page-title">Set up your business</h1>
        <p className="text-xs text-muted">A few details, once. Everything here can be changed later in Organization.</p>
      </div>
      <div className="grid grid-cols-[220px_1fr] gap-4">
        <ol className="flex flex-col gap-1" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s.key} aria-current={s.key === current ? 'step' : undefined} className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${s.key === current ? 'bg-surface font-medium' : 'text-muted'}`}>
              {i < index ? <Check className="size-4 text-good" aria-label="Done" /> : <span className="grid size-4 place-items-center text-xs">{i + 1}</span>}
              {s.label}
            </li>
          ))}
        </ol>
        <Card title={STEPS[index]?.label}>
          {current === 'company' ? <CompanyStep /> : null}
          {current === 'gst' && company ? <GstStep company={company} /> : null}
          {current === 'location' && company && registration ? <LocationStep company={company} registration={registration} /> : null}
          {current === 'warehouse' && location ? <WarehouseStep locationId={location.id} /> : null}
          {current === 'year' && company ? <YearStep company={company} /> : null}
          {current === 'defaults' && company ? <DefaultsStep company={company} registrations={regs.data ?? []} /> : null}
        </Card>
      </div>
    </div>
  )
}
