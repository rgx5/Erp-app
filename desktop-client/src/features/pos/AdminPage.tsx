import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import type { ColumnDef } from '@tanstack/react-table'
import type { LedgerAccount, Party, PosShift } from '@/api/schemas'
import { POS_METHODS } from '@/api/schemas'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { bridge, isDesktop } from '@/bridge'
import { formatDate, formatInr } from '@/domain/format'
import { AccountPicker } from '@/features/accounting/AccountPicker'
import { useAccounts } from '@/features/accounting/queries'
import { PartyPicker } from '@/features/masterdata/PartyPicker'
import { useParty } from '@/features/masterdata/queries'
import { useWorkspace } from '@/features/organization/workspace'
import { DataTable } from '@/ui/DataTable'
import { Drawer } from '@/ui/Drawer'
import { getPaper, setPaper, type Paper } from './paper'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, CheckField, Card, SelectField, Spinner, TextField } from '@/ui/primitives'
import { counterState, saveCounterState } from './counterStore'
import { useCreateTerminal, useDevices, useMapPayment, usePosSettings, useRegisterDevice, useRevokeDevice, useSavePosSettings, useShifts, useTerminals } from './queries'
import { ShiftSummary } from './ShiftDrawers'
import { useShift } from './queries'

const METHOD: Record<string, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', bank_transfer: 'Bank transfer', cheque: 'Cheque', other: 'Other' }
type Tab = 'setup' | 'shifts'

function Settings({ companyId }: { companyId: string }) {
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'pos:manage')
  const settings = usePosSettings(companyId)
  const accounts = useAccounts(companyId)
  const save = useSavePosSettings(companyId); const map = useMapPayment(companyId)
  const walkInId = settings.data?.settings?.walkInCustomerId ?? undefined
  const walkIn = useParty(walkInId)
  const flash = useFlash()
  const [customer, setCustomer] = useState<Party | null | undefined>(undefined)
  const [variance, setVariance] = useState<LedgerAccount | null | undefined>(undefined)
  const [picked, setPicked] = useState<Record<string, LedgerAccount | null>>({})
  const [problem, setProblem] = useState<string | null>(null)
  if (settings.isPending || accounts.isPending) return <Spinner />
  const mapped = (m: string): LedgerAccount | null => (m in picked ? picked[m] ?? null : accounts.data?.find((a) => a.id === settings.data?.paymentAccounts.find((p) => p.method === m)?.accountId) ?? null)
  const curCustomer = customer === undefined ? (walkIn.data ?? null) : customer
  const curVariance = variance === undefined ? accounts.data?.find((a) => a.id === settings.data?.settings?.cashVarianceAccountId) ?? null : variance
  const run = async (fn: () => Promise<unknown>, ok: string) => { setProblem(null); try { await fn(); flash.show(ok) } catch (e) { setProblem(e instanceof Error ? e.message : 'Could not save.') } }
  return (
    <Card title="Counter settings">
      <div className="grid max-w-3xl gap-4">
        <div><PartyPicker label="Walk-in customer" role="customer" value={curCustomer} onPick={setCustomer} /><p className="mt-0.5 text-xs text-muted">Sales with no named customer are booked to this customer.</p></div>
        <div><AccountPicker label="Cash over and short" groups value={curVariance} filter={(a) => a.type === 'expense' && a.controlKind === null} onPick={setVariance} /><p className="mt-0.5 text-xs text-muted">Where a difference found at cash-up is posted.</p></div>
        {canManage ? <Button className="self-start" busy={save.isPending} disabled={!curCustomer || !curVariance} onClick={() => void run(() => save.mutateAsync({ walkInCustomerId: curCustomer?.id ?? null, cashVarianceAccountId: curVariance?.id ?? null }), 'Counter settings saved.')}>Save settings</Button> : null}
        <h3 className="mt-2 text-sm font-semibold">Where each way of paying lands</h3>
        {POS_METHODS.map((m) => (
          <div key={m} className="flex items-end gap-3"><div className="flex-1"><AccountPicker label={METHOD[m] ?? m} value={mapped(m)} filter={(a) => a.type === 'asset'} onPick={(a) => setPicked({ ...picked, [m]: a })} /></div>
            {canManage ? <Button variant="secondary" disabled={!picked[m]} aria-label={`Save ${METHOD[m]}`} onClick={() => void run(() => map.mutateAsync({ method: m, accountId: (picked[m] as LedgerAccount).id }), `${METHOD[m]} account saved.`)}>Save</Button> : null}</div>))}
        {problem ? <Alert>{problem}</Alert> : null}
        <p className="text-xs text-muted">Which account takes cash, UPI or card money is for your accountant to confirm.</p>
      </div>
    </Card>
  )
}

/** Desktop only: which printer receipts go to without a dialog. A cash drawer wired to that printer opens when its driver is set to open it on each print. */
function ReceiptPrinter() {
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([])
  const [chosen, setChosen] = useState('')
  const [auto, setAuto] = useState(false)
  const [paper, setPaperState] = useState<Paper>(getPaper())
  const flash = useFlash()
  useEffect(() => { void bridge.printer.list().then(setPrinters); void bridge.settings.get().then((s) => { setChosen(s.receiptPrinter ?? ''); setAuto(s.autoPrintReceipts === true) }) }, [])
  if (!isDesktop()) return <Card title="Receipt printer"><div className="flex max-w-xl flex-col gap-3"><SelectField label="Paper roll" value={paper} onChange={(e) => { const v = e.target.value === '58' ? '58' : '80'; setPaperState(v); setPaper(v) }} options={[{ value: '80', label: '80 mm roll (most common)' }, { value: '58', label: '58 mm roll' }]} /><p className="text-sm text-muted">Printing without a dialog is available in the desktop app. In a browser, receipts open the print dialog.</p></div></Card>
  return (
    <Card title="Receipt printer (this computer)">
      <div className="flex max-w-xl flex-col gap-3">
        <SelectField label="Paper roll" value={paper} onChange={(e) => { const v = e.target.value === '58' ? '58' : '80'; setPaperState(v); setPaper(v) }} options={[{ value: '80', label: '80 mm roll (most common)' }, { value: '58', label: '58 mm roll' }]} />
        <SelectField label="Print receipts to" value={chosen} onChange={(e) => setChosen(e.target.value)} options={[{ value: '', label: 'Ask each time (save as PDF)' }, ...printers.map((p) => ({ value: p.name, label: `${p.name}${p.isDefault ? ' (default)' : ''}` }))]} />
        <CheckField label="Print the receipt by itself after each sale" checked={auto} disabled={!chosen} onChange={(e) => setAuto(e.target.checked)} />
        <p className="text-xs text-muted">Receipts are laid out for the roll chosen above. To open a cash drawer wired to the printer, switch on its &ldquo;open drawer&rdquo; option in the printer's driver settings.</p>
        <Button className="self-start" variant="secondary" onClick={async () => { await bridge.settings.set({ receiptPrinter: chosen || null, autoPrintReceipts: chosen ? auto : null }); flash.show('Receipt printer saved.') }}>Save printer</Button>
      </div>
    </Card>
  )
}

function Terminals({ companyId }: { companyId: string }) {
  const ws = useWorkspace()
  const tenant = useSession((s) => s.tenant ?? 'default')
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'pos:manage')
  const terminals = useTerminals(companyId)
  const devices = useDevices(canManage ? companyId : undefined)
  const create = useCreateTerminal(); const register = useRegisterDevice(); const revoke = useRevokeDevice()
  const flash = useFlash()
  const [adding, setAdding] = useState(false)
  const [mine, setMine] = useState(counterState(tenant).deviceId)
  const schema = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Letters, digits, - _'), name: z.string().trim().min(1, 'Required').max(100), registration: z.string().min(1), location: z.string().min(1), warehouse: z.string().min(1) })
  const regs = ws.registrations; const locs = ws.locations; const whs = ws.warehouses
  return (
    <Card title="Terminals" action={canManage ? <Button variant="secondary" onClick={() => setAdding(true)}>New terminal</Button> : undefined}>
      {terminals.isPending ? <Spinner /> : terminals.data?.length === 0 ? <Alert tone="info">No terminal yet.</Alert> : (
        <table className="w-full text-sm" aria-label="Terminals"><thead><tr className="text-left text-xs text-muted"><th className="py-1">Code</th><th className="py-1">Name</th><th className="py-1">Offline device</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{terminals.data?.map((t) => { const d = devices.data?.find((x) => x.terminalId === t.id && x.status === 'active'); return (
            <tr key={t.id} className="border-t border-line/60"><td className="py-1.5">{t.code}</td><td className="py-1.5">{t.name}</td><td className="py-1.5 text-muted">{d ? `${d.name}${d.lastSyncAt ? `, last upload ${formatDate(d.lastSyncAt.slice(0, 10))}` : ''}${mine === d.id ? ' (this computer)' : ''}` : 'none'}</td>
              <td className="py-1.5 text-right">{canManage ? (d ? <Button variant="ghost" onClick={async () => { await revoke.mutateAsync(d.id); if (mine === d.id) { saveCounterState(tenant, { deviceId: '' }); setMine('') } flash.show('Device revoked.') }}>Revoke</Button> : <Button variant="ghost" aria-label={`Register this computer for ${t.code}`} onClick={async () => { const x = await register.mutateAsync({ key: crypto.randomUUID(), body: { terminalId: t.id, name: `${t.code} computer` } }); saveCounterState(tenant, { deviceId: x.id, terminalId: t.id }); setMine(x.id); flash.show('This computer can now sell offline and upload later.') }}>Use this computer for offline selling</Button>) : null}</td></tr>) })}</tbody></table>)}
      {adding ? (
        <Drawer title="New terminal" onClose={() => setAdding(false)}>
          <SimpleForm schema={schema} defaults={{ code: '', name: '', registration: regs[0]?.id ?? '', location: locs[0]?.id ?? '', warehouse: whs[0]?.id ?? '' }} fields={['code', 'name', 'registration', 'location', 'warehouse']} label="Create"
            submit={async (v) => { await create.mutateAsync({ key: crypto.randomUUID(), body: { companyId, code: v.code, name: v.name, gstRegistrationId: v.registration, businessLocationId: v.location, warehouseId: v.warehouse } }); setAdding(false); flash.show('Terminal created.') }}>
            {({ register: r, errors }) => (<><TextField label="Code" error={errors.code?.message as string | undefined} {...r('code')} /><TextField label="Name" error={errors.name?.message as string | undefined} {...r('name')} />
              <SelectField label="GST registration" options={regs.map((x) => ({ value: x.id, label: x.gstin }))} {...r('registration')} /><SelectField label="Place of business" options={locs.map((x) => ({ value: x.id, label: x.name }))} {...r('location')} /><SelectField label="Stock is sold from" options={whs.map((x) => ({ value: x.id, label: x.name }))} {...r('warehouse')} /></>)}
          </SimpleForm>
        </Drawer>) : null}
    </Card>
  )
}

function ShiftDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useShift(id)
  return <Drawer title={q.data?.shiftNo ?? 'Shift'} onClose={onClose} width={560}>{q.isPending ? <Spinner /> : !q.data ? <Alert>{q.error?.message ?? 'Not found.'}</Alert> : (
    <div className="flex flex-col gap-3"><p className="text-sm text-muted">Opened {formatDate(q.data.openedAt.slice(0, 10))}{q.data.closedAt ? `, closed ${formatDate(q.data.closedAt.slice(0, 10))}` : ' and still open'}</p><ShiftSummary shift={q.data} />
      {q.data.status === 'closed' ? <p className="text-sm" aria-label="Cash-up">Counted {formatInr(q.data.countedCash ?? '0')} against {formatInr(q.data.expectedCash ?? '0')}: {Number(q.data.variance) === 0 ? 'no difference' : `difference ${formatInr(q.data.variance ?? '0')}`}.</p> : null}</div>)}</Drawer>
}

export function PosAdminPage() {
  const ws = useWorkspace()
  const [tab, setTab] = useState<Tab>('shifts')
  const shifts = useShifts(ws.company?.id)
  const [open, setOpen] = useState<string | null>(null)
  const columns = useMemo<ColumnDef<PosShift, unknown>[]>(() => [
    { header: 'Shift', accessorKey: 'shiftNo', size: 150 }, { header: 'Opened', accessorFn: (s) => formatDate(s.openedAt.slice(0, 10)), size: 110 }, { header: 'Opening cash', accessorFn: (s) => formatInr(s.openingCash), size: 130, meta: { align: 'right' } },
    { header: 'Counted', accessorFn: (s) => (s.countedCash ? formatInr(s.countedCash) : ''), size: 120, meta: { align: 'right' } }, { header: 'Difference', accessorFn: (s) => (s.variance ? formatInr(s.variance) : ''), size: 120, meta: { align: 'right' } }, { header: 'Status', accessorFn: (s) => (s.status === 'open' ? 'Open' : 'Closed'), size: 80 },
  ], [])
  if (ws.loading) return <Spinner />
  if (!ws.company) return <Alert tone="info">Set up your business first.</Alert>
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">Point of sale</h1>
      <div role="tablist" className="flex gap-1 border-b border-line">{([['shifts', 'Shifts'], ['setup', 'Setup']] as [Tab, string][]).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      {tab === 'setup' ? <div className="flex flex-col gap-4"><Settings companyId={ws.company.id} /><ReceiptPrinter /><Terminals companyId={ws.company.id} /></div> : (
        <>{shifts.error ? <Alert>{shifts.error.message}</Alert> : null}{shifts.isPending ? <Spinner /> : <DataTable columns={columns} rows={shifts.rows} rowKey={(s) => s.id} onOpen={(s) => setOpen(s.id)} empty="No shifts yet." height={480} />}</>)}
      {open ? <ShiftDetail id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}
