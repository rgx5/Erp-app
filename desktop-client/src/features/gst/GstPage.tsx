import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { z } from 'zod'
import { can } from '@/auth/permissions'
import { useSession } from '@/auth/session'
import { STATES } from '@/domain/india'
import { formatDate, formatInr } from '@/domain/format'
import { download, toCsv } from '@/features/masterdata/csv'
import { useWorkspace } from '@/features/organization/workspace'
import { Drawer } from '@/ui/Drawer'
import { useFlash } from '@/ui/flash'
import { SimpleForm } from '@/ui/SimpleForm'
import { Alert, Button, Card, SelectField, Spinner, TextField, Toolbar } from '@/ui/primitives'
import { Gstr2bView } from './Gstr2bView'
import { Gstr9View } from './Gstr9View'
import { useCmp08, useGstr1, useGstr3b, useItcRegister, useReturnSettings, useSetCompositionRate } from './queries'

type Tab = 'gstr1' | 'gstr3b' | 'itc' | 'cmp08' | 'rec2b' | 'gstr9'
const amt = (v: string) => (Number(v) === 0 ? '–' : formatInr(v, { symbol: false }))
const stateName = (pos: string): string => STATES.find((s) => s.code === pos)?.name ?? pos

/** The month before today, as YYYY-MM: the usual one being filed. */
function lastMonth(): string { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
/** The financial-year quarter before today, as YYYY-Qn. */
function lastQuarter(): string {
  const d = new Date(); const m = d.getMonth() // 0 = Jan
  const fy = m >= 3 ? d.getFullYear() : d.getFullYear() - 1
  const q = m >= 3 ? Math.floor((m - 3) / 3) : 3 // current quarter index, 0..3
  return q === 0 ? `${fy - 1}-Q4` : `${fy}-Q${q}`
}

function Table({ label, head, rows, foot }: { label: string; head: string[]; rows: ReactNode[][]; foot?: ReactNode[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing to report in this section.</p>
  return (
    <div className="overflow-auto rounded-lg border border-line bg-surface">
      <table className="w-full text-sm" aria-label={label}>
        <thead><tr className="bg-canvas text-left text-xs text-muted">{head.map((h, i) => <th key={h} className={`p-2 ${i >= head.length - 5 && /Taxable|IGST|CGST|SGST|Cess|Value|Amount|Qty|Tax/.test(h) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line/60">{r.map((c, j) => <td key={j} className={`p-2 ${typeof c === 'string' && /^[-\d,.–]+$/.test(c) && j > 0 ? 'num text-right' : ''}`}>{c}</td>)}</tr>)}{foot ? <tr className="border-t border-line bg-canvas font-semibold">{foot.map((c, j) => <td key={j} className={`p-2 ${j > 0 ? 'num text-right' : ''}`}>{c}</td>)}</tr> : null}</tbody>
      </table>
    </div>
  )
}
const Section = ({ title, children }: { title: string; children: ReactNode }) => <section className="flex flex-col gap-2"><h2 className="text-sm font-semibold">{title}</h2>{children}</section>
const json = (name: string, data: unknown): void => download(name, JSON.stringify(data, null, 2))

function Gstr1View({ registrationId, period }: { registrationId: string; period: string }) {
  const q = useGstr1(registrationId, period, true)
  if (q.isPending) return <Spinner />
  if (q.error) return <Alert>{q.error.message}</Alert>
  const r = q.data
  const taxes = (t: { iamt: string; camt: string; samt: string; csamt: string }): string[] => [amt(t.iamt), amt(t.camt), amt(t.samt), amt(t.csamt)]
  const it = (items: { rt: string; txval: string; iamt: string; camt: string; samt: string; csamt: string }[]) => items.reduce((a, x) => ({ txval: a.txval + Number(x.txval), t: a.t + Number(x.iamt) + Number(x.camt) + Number(x.samt) + Number(x.csamt) }), { txval: 0, t: 0 })
  const invRows = (inv: { inum?: string | null | undefined; idt?: string | null | undefined; val: string; pos: string; items: { rt: string; txval: string; iamt: string; camt: string; samt: string; csamt: string }[] }[], lead: string[] = []) =>
    inv.map((x) => { const s = it(x.items); return [...lead, x.inum ?? '', x.idt ? formatDate(x.idt) : '', stateName(x.pos), amt(x.val), amt(s.txval.toFixed(4)), amt(s.t.toFixed(4))] })
  const invHead = (lead: string[]) => [...lead, 'Invoice', 'Date', 'Place of supply', 'Value', 'Taxable', 'Tax']
  const summaryNames: Record<string, string> = { b2b: 'B2B (registered buyers)', b2cl: 'B2C large (inter-state over ₹2.5 lakh)', b2cs: 'B2C small', exp: 'Exports', cdnr: 'Credit/debit notes (registered)', cdnur: 'Credit/debit notes (unregistered)', nil: 'Nil-rated, exempt and non-GST' }
  const nilNames: Record<string, string> = { inter_reg: 'Inter-state, to registered', intra_reg: 'Intra-state, to registered', inter_unreg: 'Inter-state, to unregistered', intra_unreg: 'Intra-state, to unregistered' }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between"><p className="text-sm text-muted">{r.gstin} · {formatDate(r.from)} – {formatDate(r.to)}. Computed from posted invoices and notes; nothing is filed from here.</p>
        <Button variant="secondary" onClick={() => json(`GSTR1-${r.gstin}-${r.period.replace('-', '')}.json`, r)}>Download JSON</Button></div>
      <Section title="Summary">
        <Table label="GSTR-1 summary" head={['Section', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess']} rows={Object.entries(r.summary).map(([k, t]) => [summaryNames[k] ?? k, amt(t.txval), ...taxes(t)])} />
      </Section>
      <Section title="B2B invoices"><Table label="B2B" head={invHead(['GSTIN'])} rows={r.b2b.flatMap((g) => invRows(g.inv, [g.ctin]))} /></Section>
      <Section title="B2C large invoices"><Table label="B2CL" head={invHead([])} rows={r.b2cl.flatMap((g) => invRows(g.inv))} /></Section>
      <Section title="B2C small (consolidated)"><Table label="B2CS" head={['Supply', 'Place of supply', 'Rate %', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess']} rows={r.b2cs.map((x) => [x.sply_ty === 'INTER' ? 'Inter-state' : 'Intra-state', stateName(x.pos), x.rt, amt(x.txval), ...taxes(x)])} /></Section>
      <Section title="Exports"><Table label="Exports" head={invHead(['Type'])} rows={r.exp.flatMap((g) => invRows(g.inv, [g.exp_typ === 'WPAY' ? 'With payment' : 'Without payment']))} /></Section>
      <Section title="Credit and debit notes"><Table label="Notes" head={['GSTIN', 'Note', 'Date', 'Type', 'Against', 'Value', 'Taxable', 'Tax']} rows={[...r.cdnr.flatMap((g) => g.nt.map((n) => { const s = it(n.items); return [g.ctin, n.nt_num, formatDate(n.nt_dt), n.ntty === 'C' ? 'Credit' : 'Debit', n.inum ?? '', amt(n.val), amt(s.txval.toFixed(4)), amt(s.t.toFixed(4))] })), ...r.cdnur.map((n) => { const s = it(n.items); return ['Unregistered', n.nt_num, formatDate(n.nt_dt), n.ntty === 'C' ? 'Credit' : 'Debit', n.inum ?? '', amt(n.val), amt(s.txval.toFixed(4)), amt(s.t.toFixed(4))] })]} /></Section>
      <Section title="Nil-rated, exempt and non-GST"><Table label="Nil" head={['Kind', 'Amount']} rows={Object.entries(r.nil).filter(([, v]) => Number(v) !== 0).map(([k, v]) => [nilNames[k] ?? k, amt(v)])} /></Section>
      <Section title="HSN summary">
        <Table label="HSN" head={['HSN/SAC', 'Unit', 'Rate %', 'Qty', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess']} rows={r.hsn.map((h) => [h.hsn_sc, h.uqc, h.rt, h.qty, amt(h.txval), ...taxes(h)])} />
        {r.hsn.length ? <Button variant="ghost" className="self-start" onClick={() => download(`HSN-${r.period}.csv`, toCsv(['HSN', 'UQC', 'Rate', 'Qty', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess'], r.hsn.map((h) => [h.hsn_sc, h.uqc, h.rt, h.qty, h.txval, h.iamt, h.camt, h.samt, h.csamt])))}>Export HSN CSV</Button> : null}
      </Section>
      <Section title="Documents issued"><Table label="Documents issued" head={['Type', 'From', 'To', 'Total', 'Cancelled', 'Net issued']} rows={r.doc_issue.map((d) => [d.doc_typ.replaceAll('_', ' '), d.from, d.to, String(d.totnum), String(d.cancel), String(d.net_issue)])} /></Section>
    </div>
  )
}

function Gstr3bView({ registrationId, period }: { registrationId: string; period: string }) {
  const q = useGstr3b(registrationId, period, true)
  if (q.isPending) return <Spinner />
  if (q.error) return <Alert>{q.error.message}</Alert>
  const r = q.data
  const s = r.sup_details; const i = r.itc_elg; const p = r.tax_pmt
  const a = (label: string, t: { txval: string; iamt: string; camt: string; samt: string; csamt: string }) => [label, amt(t.txval), amt(t.iamt), amt(t.camt), amt(t.samt), amt(t.csamt)]
  const h = ['', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess']
  const four = (label: string, t: { igst: string; cgst: string; sgst: string; cess: string }) => [label, amt(t.igst), amt(t.cgst), amt(t.sgst), amt(t.cess)]
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between"><p className="text-sm text-muted">{r.gstin} · {formatDate(r.from)} – {formatDate(r.to)}. A working summary to check against the portal before filing.</p>
        <Button variant="secondary" onClick={() => json(`GSTR3B-${r.gstin}-${r.period.replace('-', '')}.json`, r)}>Download JSON</Button></div>
      <Section title="3.1 Outward supplies and inward supplies liable to reverse charge">
        <Table label="3.1" head={h} rows={[a('(a) Taxable outward supplies', s.osup_det), a('(b) Zero rated (exports and SEZ)', s.osup_zero), ['(c) Nil rated and exempt', amt(s.osup_nil_exmp.txval), '', '', '', ''], a('(d) Inward supplies on reverse charge', s.isup_rev), ['(e) Non-GST outward supplies', amt(s.osup_nongst.txval), '', '', '', '']]} />
      </Section>
      <Section title="3.2 Inter-state supplies to unregistered persons and composition dealers">
        <Table label="3.2" head={['Kind', 'Place of supply', 'Taxable', 'IGST']} rows={[...r.inter_sup.unreg_details.map((x) => ['Unregistered', stateName(x.pos), amt(x.txval), amt(x.iamt)]), ...r.inter_sup.comp_details.map((x) => ['Composition', stateName(x.pos), amt(x.txval), amt(x.iamt)])]} />
      </Section>
      <Section title="4. Eligible input tax credit">
        <Table label="4" head={h} rows={[a('(A)(1) Import of goods and services', i.itc_avl.impg_and_imps), a('(A)(3) Reverse charge', i.itc_avl.isrc), a('(A)(5) All other ITC', i.itc_avl.oth), a('(B) ITC reversed', i.itc_rev.oth), a('(C) Net ITC available', i.itc_net), a('(D) Ineligible ITC', i.itc_inelg.oth)]} />
      </Section>
      <Section title="5. Exempt, nil-rated and non-GST inward supplies">
        <Table label="5" head={['', 'Amount']} rows={[['Inter-state', amt(r.inward_sup.isup_details.inter)], ['Intra-state', amt(r.inward_sup.isup_details.intra)]]} />
      </Section>
      <Section title="6. Payment of tax">
        <Table label="6" head={['', 'IGST', 'CGST', 'SGST', 'Cess']} rows={[four('Tax liability', p.liability), four('  of which on reverse charge', p.liability.reverse_charge), four('Paid through input credit', p.paid_through_itc), four('Payable in cash', p.payable_in_cash), four('Input credit left over', p.itc_unused)]} />
      </Section>
    </div>
  )
}

function ItcView({ registrationId, period }: { registrationId: string; period: string }) {
  const q = useItcRegister(registrationId, period, true)
  if (q.isPending) return <Spinner />
  if (q.error) return <Alert>{q.error.message}</Alert>
  const r = q.data
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Every supplier bill and debit note of the month and the input credit it carries. Blocked credit is tax on items the law does not allow you to claim.</p>
      <Table label="ITC register" head={['Document', 'Date', 'Supplier GSTIN', 'Kind', 'Taxable', 'IGST', 'CGST', 'SGST', 'ITC available', 'ITC blocked']}
        rows={r.documents.map((d) => [d.document + (d.reverseCharge ? ' (RCM)' : ''), formatDate(d.date), d.supplierGstin ?? '', d.type === 'debit_note' ? 'Debit note' : 'Bill', amt(d.taxable), amt(d.igst), amt(d.cgst), amt(d.sgst), amt(d.itcAvailable), amt(d.itcBlocked)])}
        foot={['Total', '', '', '', '', '', '', '', amt(r.totals.itcAvailable), amt(r.totals.itcBlocked)]} />
      {r.documents.length ? <Button variant="secondary" className="self-start" onClick={() => download(`itc-register-${r.period}.csv`, toCsv(['Document', 'Date', 'Supplier GSTIN', 'Type', 'Reverse charge', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess', 'ITC available', 'ITC blocked'], r.documents.map((d) => [d.document, d.date, d.supplierGstin ?? '', d.type, d.reverseCharge ? 'Y' : 'N', d.taxable, d.igst, d.cgst, d.sgst, d.cess, d.itcAvailable, d.itcBlocked])))}>Export CSV</Button> : null}
    </div>
  )
}

function Cmp08View({ registrationId, quarter }: { registrationId: string; quarter: string }) {
  const q = useCmp08(registrationId, quarter, true)
  if (q.isPending) return <Spinner />
  if (q.error) return <Alert>{q.error.message}</Alert>
  const r = q.data
  return (
    <Card title={`CMP-08 · ${r.quarter} · ${formatDate(r.from)} – ${formatDate(r.to)}`}>
      <Table label="CMP-08" head={['', 'Value', 'Integrated', 'Central', 'State']} rows={[
        [`Outward supplies at ${r.outward.ratePercent}%`, amt(r.outward.turnover), amt(r.outward.integrated), amt(r.outward.central), amt(r.outward.state)],
        ['Inward supplies on reverse charge', amt(r.inwardReverseCharge.taxable), amt(r.inwardReverseCharge.integrated), amt(r.inwardReverseCharge.central), amt(r.inwardReverseCharge.state)],
      ]} foot={['Total tax payable', '', '', '', amt(r.totalPayable)]} />
      <Button variant="secondary" className="mt-3" onClick={() => json(`CMP08-${r.gstin}-${r.quarter}.json`, r)}>Download JSON</Button>
    </Card>
  )
}

export function GstPage() {
  const ws = useWorkspace()
  const flash = useFlash()
  const canManage = can(useSession((s) => s.me?.permissions ?? []), 'gst:manage')
  const [regId, setRegId] = useState('')
  const [tab, setTab] = useState<Tab>('gstr1')
  const [period, setPeriod] = useState(lastMonth())
  const [quarter, setQuarter] = useState(lastQuarter())
  const [rate, setRate] = useState(false)
  const [fy, setFy] = useState(() => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y - 1}-${String(y % 100).padStart(2, '0')}` })
  const reg = ws.registrations.find((r) => r.id === regId) ?? ws.registrations[0]
  const composition = reg?.registrationType === 'composition'
  const settings = useReturnSettings(composition ? reg?.id : undefined)
  const setRateM = useSetCompositionRate(reg?.id ?? '')
  if (ws.loading) return <Spinner />
  if (!ws.company || !reg) return <Alert tone="info">No GST registration yet. <Link to="/setup" className="underline">Set up your business</Link>.</Alert>
  const tabs: [Tab, string][] = composition ? [['cmp08', 'CMP-08']] : [['gstr1', 'GSTR-1'], ['gstr3b', 'GSTR-3B'], ['itc', 'ITC register'], ['rec2b', 'GSTR-2B check'], ['gstr9', 'Annual (GSTR-9)']]
  const active: Tab = composition ? 'cmp08' : tab
  return (
    <div className="flex flex-col gap-4">
      <h1 className="page-title">GST returns</h1>
      <Toolbar>
        <div className="w-80"><SelectField label="GST registration" value={reg.id} onChange={(e) => setRegId(e.target.value)} options={ws.registrations.map((r) => ({ value: r.id, label: `${r.gstin} · ${r.registrationType === 'composition' ? 'Composition' : 'Regular'}` }))} /></div>
        {active === 'gstr9' ? <div className="w-40"><TextField label="Financial year" value={fy} placeholder="2025-26" onChange={(e) => setFy(e.target.value)} hint="April to March" /></div> : active === 'cmp08' ? <div className="w-40"><TextField label="Quarter" value={quarter} placeholder="2026-Q1" onChange={(e) => setQuarter(e.target.value.toUpperCase())} hint="Q1 = April to June" /></div> : <div className="w-44"><TextField label="Month" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></div>}
        {composition && canManage ? <Button variant="secondary" className="self-end" onClick={() => setRate(true)}>Composition rate{settings.data?.compositionRate ? ` (${settings.data.compositionRate}%)` : ''}</Button> : null}
      </Toolbar>
      <div role="tablist" className="flex gap-1 border-b border-line">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={active === id} className={`-mb-px border-b-2 px-3 py-2 text-sm ${active === id ? 'border-brand font-medium text-brand' : 'border-transparent text-muted hover:text-ink'}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {active === 'gstr1' ? <Gstr1View key={`${reg.id}${period}`} registrationId={reg.id} period={period} /> : null}
      {active === 'gstr3b' ? <Gstr3bView key={`${reg.id}${period}`} registrationId={reg.id} period={period} /> : null}
      {active === 'itc' ? <ItcView key={`${reg.id}${period}`} registrationId={reg.id} period={period} /> : null}
      {active === 'rec2b' ? <Gstr2bView key={`${reg.id}${period}`} registrationId={reg.id} period={period} /> : null}
      {active === 'gstr9' && /^\d{4}-\d{2}$/.test(fy) ? <Gstr9View key={`${reg.id}${fy}`} registrationId={reg.id} fy={fy} /> : null}
      {active === 'cmp08' ? <Cmp08View key={`${reg.id}${quarter}`} registrationId={reg.id} quarter={quarter} /> : null}
      {rate ? (
        <Drawer title="Composition rate" onClose={() => setRate(false)}>
          <p className="mb-3 text-sm text-muted">The percentage of turnover you pay under the composition scheme. CMP-08 cannot be prepared until it is set. Confirm the rate for your business with your accountant.</p>
          <SimpleForm schema={z.object({ rate: z.string().regex(/^(100(\.0{1,4})?|[0-9]{1,2}(\.[0-9]{1,4})?)$/, 'A percentage such as 1 or 0.5') })} defaults={{ rate: settings.data?.compositionRate ?? '' }} fields={['rate']} label="Save rate" submit={async (v) => { await setRateM.mutateAsync(v.rate); setRate(false); flash.show('Composition rate saved.') }}>
            {({ register, errors }) => <TextField label="Rate (%)" error={errors.rate?.message as string | undefined} {...register('rate')} />}
          </SimpleForm>
        </Drawer>
      ) : null}
    </div>
  )
}
