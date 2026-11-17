import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import type { PaymentTerm, TaxCode, Unit } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { formatDate } from '@/domain/format'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, SelectField, Spinner, TextField } from '@/ui/primitives'
import { useAddTaxRate, useCreatePaymentTerm, useCreateTaxCode, useCreateUnit, usePaymentTerms, useTaxCodes, useTaxRates, useUnits } from './queries'

const KINDS = [{ value: 'gst', label: 'GST (with a rate)' }, { value: 'exempt', label: 'Exempt' }, { value: 'nil_rated', label: 'Nil rated' }, { value: 'non_gst', label: 'Non-GST' }]
const useCan = (...p: string[]): boolean => can(useSession((s) => s.me?.permissions ?? []), ...p)
const Header = ({ title, action }: { title: string; action?: React.ReactNode }) => <div className="flex items-center justify-between"><h1 className="text-lg font-semibold">{title}</h1>{action}</div>

// ---- tax codes ---------------------------------------------------------------------------------------------------------
const taxCodeSchema = z.object({ code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/, 'Capital letters, digits and . _ -'), name: z.string().trim().min(1, 'Required').max(100), kind: z.string() })
const rateSchema = z.object({ effectiveFrom: z.string().min(1, 'Required'), igstRate: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'A percentage such as 18 or 2.5').refine((v) => Number(v) <= 100, 'At most 100'), cessRate: z.string().regex(/^\d{1,4}(\.\d{1,4})?$/, 'A percentage such as 0 or 12') })

function TaxCodeDetail({ code, canManage }: { code: TaxCode; canManage: boolean }) {
  const rates = useTaxRates(code.id)
  const add = useAddTaxRate(code.id)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{code.name} · {KINDS.find((k) => k.value === code.kind)?.label ?? code.kind}. A rate applies from its start date until the next one starts; the CGST and SGST halves are worked out for you.</p>
      {rates.isPending ? <Spinner /> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1">From</th><th className="py-1">To</th><th className="num py-1 text-right">IGST</th><th className="num py-1 text-right">CGST</th><th className="num py-1 text-right">SGST</th><th className="num py-1 text-right">Cess</th></tr></thead>
          <tbody>
            {(rates.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-line/60">
                <td className="py-1.5">{formatDate(r.effectiveFrom)}</td><td className="py-1.5">{r.effectiveTo ? formatDate(r.effectiveTo) : 'open'}</td>
                <td className="num py-1.5 text-right">{Number(r.igstRate)}%</td><td className="num py-1.5 text-right">{Number(r.cgstRate)}%</td><td className="num py-1.5 text-right">{Number(r.sgstRate)}%</td><td className="num py-1.5 text-right">{Number(r.cessRate)}%</td>
              </tr>
            ))}
            {(rates.data ?? []).length === 0 ? <tr><td colSpan={6} className="py-3 text-center text-muted">No rate yet.</td></tr> : null}
          </tbody>
        </table>
      )}
      {canManage && code.kind === 'gst' ? (
        <div className="border-t border-line pt-4">
          <h3 className="mb-2 text-sm font-semibold">Add a rate</h3>
          <SimpleForm schema={rateSchema} defaults={{ effectiveFrom: '', igstRate: '18', cessRate: '0' }} fields={['effectiveFrom', 'igstRate', 'cessRate']} label="Add rate" submit={(v) => add.mutateAsync({ effectiveFrom: v.effectiveFrom, igstRate: Number(v.igstRate), cessRate: Number(v.cessRate) })}>
            {({ register, errors }) => (
              <>
                <TextField label="Applies from" type="date" error={errors.effectiveFrom?.message as string | undefined} {...register('effectiveFrom')} />
                <div className="grid grid-cols-2 gap-3">
                  <TextField label="GST rate (IGST %)" inputMode="decimal" error={errors.igstRate?.message as string | undefined} {...register('igstRate')} hint="Half is CGST, half is SGST" />
                  <TextField label="Cess %" inputMode="decimal" error={errors.cessRate?.message as string | undefined} {...register('cessRate')} />
                </div>
              </>
            )}
          </SimpleForm>
        </div>
      ) : null}
    </div>
  )
}

export function TaxCodesPage() {
  const canManage = useCan('tax:manage')
  const list = useTaxCodes()
  const create = useCreateTaxCode()
  const [open, setOpen] = useState<TaxCode | 'new' | null>(null)
  const columns: ColumnDef<TaxCode, unknown>[] = [{ header: 'Code', accessorKey: 'code', size: 140 }, { header: 'Name', accessorKey: 'name', size: 260 }, { header: 'Kind', accessorFn: (t) => KINDS.find((k) => k.value === t.kind)?.label ?? t.kind, size: 180 }, { header: 'Status', accessorKey: 'status', size: 90 }]
  return (
    <div className="flex flex-col gap-4">
      <Header title="Tax codes" action={canManage ? <Button onClick={() => setOpen('new')}><Plus className="size-4" aria-hidden /> New tax code</Button> : null} />
      {list.error ? <Alert>{list.error.message}</Alert> : null}
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(t) => t.id} onOpen={setOpen} empty="No tax codes yet. Apply the standard setup or add one." />}
      {open === 'new' ? (
        <Drawer title="New tax code" onClose={() => setOpen(null)}>
          <SimpleForm schema={taxCodeSchema} defaults={{ code: '', name: '', kind: 'gst' }} fields={['code', 'name', 'kind']} label="Create tax code" submit={async (v) => { await create.mutateAsync({ code: v.code.trim(), name: v.name.trim(), kind: v.kind as 'gst' }); setOpen(null) }}>
            {({ register, errors }) => (
              <>
                <TextField label="Code" error={errors.code?.message as string | undefined} {...register('code')} hint="For example GST18" />
                <TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} />
                <SelectField label="Kind" options={KINDS} {...register('kind')} />
              </>
            )}
          </SimpleForm>
        </Drawer>
      ) : open ? <Drawer title={open.code} onClose={() => setOpen(null)} width={600}><TaxCodeDetail code={open} canManage={canManage} /></Drawer> : null}
    </div>
  )
}

// ---- units -------------------------------------------------------------------------------------------------------------
const unitSchema = z.object({ code: z.string().trim().regex(/^[A-Z0-9]{1,10}$/, 'Up to 10 capital letters or digits'), name: z.string().trim().min(1, 'Required').max(100), decimalPlaces: z.string().regex(/^[0-6]$/, '0 to 6') })
export function UnitsPage() {
  const canWrite = useCan('masterdata:write')
  const list = useUnits()
  const create = useCreateUnit()
  const [open, setOpen] = useState(false)
  const columns: ColumnDef<Unit, unknown>[] = [{ header: 'Code', accessorKey: 'code', size: 100 }, { header: 'Name', accessorKey: 'name', size: 240 }, { header: 'GST code (UQC)', accessorFn: (u) => u.uqc ?? '', size: 140 }, { header: 'Decimals', accessorKey: 'decimalPlaces', size: 90, meta: { align: 'right' } }, { header: 'Status', accessorKey: 'status', size: 90 }]
  return (
    <div className="flex flex-col gap-4">
      <Header title="Units of measure" action={canWrite ? <Button onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden /> New unit</Button> : null} />
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(u) => u.id} height={600} />}
      {open ? (
        <Drawer title="New unit" onClose={() => setOpen(false)}>
          <SimpleForm schema={unitSchema} defaults={{ code: '', name: '', decimalPlaces: '3' }} fields={['code', 'name', 'uqc', 'decimalPlaces']} label="Create unit" submit={async (v) => { await create.mutateAsync({ code: v.code.trim(), name: v.name.trim(), decimalPlaces: Number(v.decimalPlaces) }); setOpen(false) }}>
            {({ register, errors }) => (
              <>
                <TextField label="Code" error={errors.code?.message as string | undefined} {...register('code')} />
                <TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} />
                <TextField label="Decimal places" inputMode="numeric" error={errors.decimalPlaces?.message as string | undefined} {...register('decimalPlaces')} hint="0 for things you count, 3 for things you weigh or measure" />
              </>
            )}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}

// ---- payment terms -----------------------------------------------------------------------------------------------------
const termSchema = z.object({ code: z.string().trim().regex(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/, 'Capital letters, digits and . _ -'), name: z.string().trim().min(1, 'Required').max(100), netDays: z.string().regex(/^\d{1,3}$/, '0 to 365').refine((v) => Number(v) <= 365, '0 to 365') })
export function PaymentTermsPage() {
  const canWrite = useCan('masterdata:write')
  const list = usePaymentTerms()
  const create = useCreatePaymentTerm()
  const [open, setOpen] = useState(false)
  const columns: ColumnDef<PaymentTerm, unknown>[] = [{ header: 'Code', accessorKey: 'code', size: 120 }, { header: 'Name', accessorKey: 'name', size: 260 }, { header: 'Days to pay', accessorKey: 'netDays', size: 110, meta: { align: 'right' } }]
  return (
    <div className="flex flex-col gap-4">
      <Header title="Payment terms" action={canWrite ? <Button onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden /> New payment term</Button> : null} />
      {list.isPending ? <Spinner /> : <DataTable columns={columns} rows={list.data ?? []} rowKey={(t) => t.id} empty="No payment terms yet." />}
      {open ? (
        <Drawer title="New payment term" onClose={() => setOpen(false)}>
          <SimpleForm schema={termSchema} defaults={{ code: '', name: '', netDays: '30' }} fields={['code', 'name', 'netDays']} label="Create payment term" submit={async (v) => { await create.mutateAsync({ code: v.code.trim(), name: v.name.trim(), netDays: Number(v.netDays) }); setOpen(false) }}>
            {({ register, errors }) => (
              <>
                <TextField label="Code" error={errors.code?.message as string | undefined} {...register('code')} hint="For example NET30" />
                <TextField label="Name" error={errors.name?.message as string | undefined} {...register('name')} />
                <TextField label="Days to pay" inputMode="numeric" error={errors.netDays?.message as string | undefined} {...register('netDays')} />
              </>
            )}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}
