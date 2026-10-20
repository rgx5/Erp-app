import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { stateName, taxInfoOf } from '@/domain/gst'
import { inr } from '@/domain/money'
import { useStore } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { buildEInvoice, eInvoiceFile, eInvoiceSkipReason, parseIrpResponse } from '@/modules/pricing/einvoice'
import { buildEway, ewayFile, ewbNeeded, ewbValidityDays, TRANSPORT_MODES } from '@/modules/pricing/eway'
import { cancelEInvoice, cancelEwayBill, recordEwayBill, recordIrn, saveEInvoiceDetails, saveEwayDetails } from '@/modules/pricing/ops'
import { eInvoiceId, ewayId, type Transport } from '@/modules/pricing/types'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ask, toast } from '@/ui/overlays'

const STOPS = 'This app stops at the file. Upload it on the government portal; it cannot be registered from here.'

/** One GST invoice: its e-invoice (IRN) and e-way bill, from the file to the number the portal gave back. */
export default function B2BBill() {
  const { billId } = useLocalSearchParams<{ billId: string }>()
  const can = useCan('pricing')
  const bill = useApp((s) => s.data.bills[billId])
  const [tab, setTab] = useState<'einvoice' | 'eway'>('einvoice')
  if (!can) return <Screen title="GST invoice" back><T tone="mute">GST invoices are for the owner and managers.</T></Screen>
  if (!bill) return <Screen title="Not found" back><T tone="mute">This bill is no longer here.</T></Screen>
  return (
    <Screen title={bill.no} subtitle={`${fmtDate(bill.date)} · ${inr(Math.abs(bill.total))}`} back>
      <View style={{ gap: 14, paddingBottom: 24 }}>
        <Segmented value={tab} options={[{ value: 'einvoice', label: 'E-invoice' }, { value: 'eway', label: 'E-way bill' }]} onChange={setTab} />
        {tab === 'einvoice' ? <EInvoice billId={bill.id} /> : <Eway billId={bill.id} />}
      </View>
    </Screen>
  )
}

const failure = (e: unknown, fallback: string) => toast(e instanceof OpError ? e.message : fallback, 'err')

function Problems({ problems, ok }: { problems: string[]; ok: string }) {
  if (!problems.length) return <Notice tone="success" title={ok} />
  return (
    <Card style={{ gap: 6 }}>
      <T v="bodyStrong">The portal would refuse this until you fix:</T>
      {problems.map((p) => <T key={p} v="caption" tone="danger">• {p}</T>)}
    </Card>
  )
}

function EInvoice({ billId }: { billId: string }) {
  const store = useStore()
  const bill = useApp((s) => s.data.bills[billId])
  const customer = useApp((s) => (s.data.bills[billId]?.customerId ? s.data.customers[s.data.bills[billId].customerId!] : null))
  const original = useApp((s) => (bill.refundOfBillId ? s.data.bills[bill.refundOfBillId] : null))
  const settings = useApp((s) => s.data.pricingSettings?.settings)
  const rec = useApp((s) => s.data.eInvoices[eInvoiceId(billId)])
  const [name, setName] = useState(rec?.buyer?.name ?? '')
  const [addr1, setAddr1] = useState(rec?.buyer?.addr1 ?? customer?.address ?? '')
  const [addr2, setAddr2] = useState(rec?.buyer?.addr2 ?? '')
  const [loc, setLoc] = useState(rec?.buyer?.loc ?? '')
  const [pin, setPin] = useState(rec?.buyer?.pin ?? '')
  const [paste, setPaste] = useState('')
  const info = taxInfoOf(bill)
  const buyer = { name, addr1, addr2, loc, pin }
  const skip = eInvoiceSkipReason(bill, store, customer)
  const build = useMemo(() => buildEInvoice({ bill, store, settings, customer, original, record: { buyer } }), [bill, store, settings, customer, original, name, addr1, addr2, loc, pin]) // eslint-disable-line react-hooks/exhaustive-deps
  const locked = rec?.status === 'registered' || rec?.status === 'cancelled'

  function saveDetails() { try { perform((s, ctx) => saveEInvoiceDetails(s, billId, buyer, ctx)); toast('Buyer details saved', 'ok') } catch (e) { failure(e, 'Could not save') } }
  function exportFile() { void shareFile(`einvoice-${bill.no}.json`.replace(/[^A-Za-z0-9._-]/g, '-'), eInvoiceFile([build.payload]), 'application/json') }
  function record() {
    const r = parseIrpResponse(paste)
    if (!r.ok) { toast(r.message, 'err'); return }
    try { perform((s, ctx) => recordIrn(s, billId, r.ack, ctx)); setPaste(''); toast('IRN recorded — it now prints on the invoice', 'ok') } catch (e) { failure(e, 'Could not record the IRN') }
  }
  async function cancel() {
    if (!(await ask({ title: 'Mark this e-invoice cancelled?', message: 'Cancel it on the IRP portal first (allowed within 24 hours). This only notes it here. A cancelled invoice number cannot be used again: issue a new bill.', confirm: 'Mark cancelled', danger: true }))) return
    try { perform((s, ctx) => cancelEInvoice(s, billId, 'Cancelled on the IRP portal', ctx)); toast('Marked cancelled', 'ok') } catch (e) { failure(e, 'Could not change') }
  }

  if (skip) return <Notice tone="primary" title="No e-invoice for this bill" body={skip} />
  return (
    <View style={{ gap: 14 }}>
      <Card>
        <KV k="Buyer" v={info.buyerName || customer?.name || '—'} />
        <KV k="Buyer GSTIN" v={info.buyerGstin || customer?.gstin || '—'} />
        <KV k="Place of supply" v={stateName(info.placeOfSupply || (info.buyerGstin || customer?.gstin || '').slice(0, 2)) || '—'} />
        <KV k="Document" v={rec?.docType === 'CRN' || bill.refundOfBillId ? 'Credit note (CRN)' : 'Invoice (INV)'} />
      </Card>

      {rec?.status === 'registered' ? (
        <Card style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Badge tone="success">IRN recorded</Badge><T v="caption" tone="mute">{rec.ackDate}</T></View>
          <T v="label" tone="soft">IRN</T>
          <T selectable style={{ fontFamily: undefined }}>{rec.irn}</T>
          <T v="caption" tone="mute">Ack no. {rec.ackNo}{rec.signedQr ? ' · the signed QR prints on the A4 invoice' : ' · no signed QR was in the response, so none prints'}</T>
          <Button label="Mark cancelled on the portal" kind="danger" onPress={cancel} />
        </Card>
      ) : rec?.status === 'cancelled' ? (
        <Notice tone="danger" title="This e-invoice was cancelled" body={rec.cancelReason} />
      ) : null}

      {!locked ? (
        <>
          <Section title="Buyer details the portal needs">
            <View style={{ gap: 12 }}>
              <Field label="Legal name" value={name} onChangeText={setName} placeholder={info.buyerName || customer?.name} />
              <Field label="Address" value={addr1} onChangeText={setAddr1} />
              <Field label="Address line 2 (optional)" value={addr2} onChangeText={setAddr2} />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 2 }}><Field label="City / town" value={loc} onChangeText={setLoc} /></View>
                <View style={{ flex: 1 }}><NumberField label="Pincode" value={pin} onChange={(t) => setPin(t.slice(0, 6))} /></View>
              </View>
              <Button label="Save buyer details" kind="soft" onPress={saveDetails} />
            </View>
          </Section>
          <Problems problems={build.problems} ok="Ready to export" />
          <Button label="Export e-invoice file (JSON)" disabled={!!build.problems.length} onPress={exportFile} />
          <Notice tone="primary" title="Registering happens on the portal" body={`${STOPS} Upload it in the IRP’s bulk-generation tool, then paste what it returns below.`} />
        </>
      ) : null}

      {rec?.status !== 'registered' && rec?.status !== 'cancelled' ? (
        <Section title="Paste the portal’s answer">
          <View style={{ gap: 10 }}>
            <Field value={paste} onChangeText={setPaste} multiline placeholder='{"Irn":"…","AckNo":…,"AckDt":"…","SignedQRCode":"…"}' autoCapitalize="none" autoCorrect={false} />
            <Button label="Record IRN" kind="outline" disabled={!paste.trim()} onPress={record} />
          </View>
        </Section>
      ) : null}
    </View>
  )
}

function Eway({ billId }: { billId: string }) {
  const store = useStore()
  const bill = useApp((s) => s.data.bills[billId])
  const customer = useApp((s) => (s.data.bills[billId]?.customerId ? s.data.customers[s.data.bills[billId].customerId!] : null))
  const settings = useApp((s) => s.data.pricingSettings?.settings)
  const inv = useApp((s) => s.data.eInvoices[eInvoiceId(billId)])
  const rec = useApp((s) => s.data.ewayBills[ewayId(billId)])
  const [mode, setMode] = useState<Transport['mode']>(rec?.transport.mode ?? 'road')
  const [km, setKm] = useState(String(rec?.transport.distanceKm ?? ''))
  const [vehicle, setVehicle] = useState(rec?.transport.vehicleNo ?? '')
  const [odc, setOdc] = useState(rec?.transport.vehicleType === 'odc')
  const [tid, setTid] = useState(rec?.transport.transporterId ?? '')
  const [tname, setTname] = useState(rec?.transport.transporterName ?? '')
  const [tdoc, setTdoc] = useState(rec?.transport.transDocNo ?? '')
  const [tdate, setTdate] = useState(rec?.transport.transDocDate ?? '')
  const [dpin, setDpin] = useState(rec?.shipTo?.pin ?? inv?.buyer?.pin ?? '')
  const [dloc, setDloc] = useState(rec?.shipTo?.loc ?? inv?.buyer?.loc ?? '')
  const [dadr, setDadr] = useState(rec?.shipTo?.addr1 ?? '')
  const [ewb, setEwb] = useState('')
  const [valid, setValid] = useState('')
  const need = ewbNeeded(bill, settings)
  const transport: Transport = { mode, distanceKm: Number(km) || 0, vehicleNo: vehicle, vehicleType: odc ? 'odc' : 'regular', transporterId: tid, transporterName: tname, transDocNo: tdoc, transDocDate: tdate }
  const shipTo = { pin: dpin, loc: dloc, addr1: dadr }
  const build = useMemo(
    () => buildEway({ bill, store, settings, customer, buyer: inv?.buyer, record: { transport, shipTo } }),
    [bill, store, settings, customer, inv, mode, km, vehicle, odc, tid, tname, tdoc, tdate, dpin, dloc, dadr], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const locked = rec?.status === 'generated' || rec?.status === 'cancelled'

  function saveDetails() { try { perform((s, ctx) => saveEwayDetails(s, billId, { transport, shipTo }, ctx)); toast('Transport details saved', 'ok') } catch (e) { failure(e, 'Could not save') } }
  function exportFile() { void shareFile(`ewaybill-${bill.no}.json`.replace(/[^A-Za-z0-9._-]/g, '-'), ewayFile([build.payload]), 'application/json') }
  function record() { try { perform((s, ctx) => recordEwayBill(s, billId, { ewbNo: ewb, validUpto: valid || undefined }, ctx)); setEwb(''); toast('E-way bill number recorded', 'ok') } catch (e) { failure(e, 'Could not record') } }
  async function cancel() {
    if (!(await ask({ title: 'Mark this e-way bill cancelled?', message: 'Cancel it on the e-way bill portal first. This only notes it here.', confirm: 'Mark cancelled', danger: true }))) return
    try { perform((s, ctx) => cancelEwayBill(s, billId, 'Cancelled on the e-way bill portal', ctx)); toast('Marked cancelled', 'ok') } catch (e) { failure(e, 'Could not change') }
  }

  return (
    <View style={{ gap: 14 }}>
      <Notice tone={need.needed ? 'warning' : 'primary'} title={need.needed ? 'An e-way bill is needed for this sale' : 'An e-way bill may not be needed'} body={need.reason} />
      {rec?.status === 'generated' ? (
        <Card style={{ gap: 6 }}>
          <Badge tone="success">E-way bill recorded</Badge>
          <T v="num">{rec.ewbNo}</T>
          {rec.validUpto ? <T v="caption" tone="mute">Valid until {rec.validUpto}</T> : null}
          <Button label="Mark cancelled on the portal" kind="danger" onPress={cancel} />
        </Card>
      ) : rec?.status === 'cancelled' ? <Notice tone="danger" title="This e-way bill was cancelled" body={rec.cancelReason} /> : null}

      {!locked ? (
        <>
          <Section title="Where it is going and how">
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><NumberField label="Delivery pincode" value={dpin} onChange={(t) => setDpin(t.slice(0, 6))} /></View>
                <View style={{ flex: 1 }}><Field label="Town (optional)" value={dloc} onChangeText={setDloc} /></View>
              </View>
              <Field label="Delivery address (optional, if not the buyer’s)" value={dadr} onChangeText={setDadr} />
              <Segmented value={mode} options={TRANSPORT_MODES} onChange={setMode} />
              <NumberField label="Distance (km)" value={km} onChange={setKm} hint={Number(km) > 0 ? `Valid for ${ewbValidityDays(Number(km), odc)} day(s)` : '0 lets the portal work it out from the pincodes'} />
              <Field label="Vehicle number" value={vehicle} onChangeText={(t) => setVehicle(t.toUpperCase())} autoCapitalize="characters" placeholder="MH12AB1234" />
              <Field label="Transporter GSTIN (if the transporter adds the vehicle)" value={tid} onChangeText={(t) => setTid(t.toUpperCase())} autoCapitalize="characters" />
              <Field label="Transporter name (optional)" value={tname} onChangeText={setTname} />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><Field label="Transport doc no. (LR / RR)" value={tdoc} onChangeText={setTdoc} /></View>
                <View style={{ flex: 1 }}><Field label="Doc date" value={tdate} onChangeText={setTdate} placeholder="YYYY-MM-DD" /></View>
              </View>
              <Segmented value={odc ? 'odc' : 'regular'} options={[{ value: 'regular', label: 'Regular cargo' }, { value: 'odc', label: 'Over-dimensional' }]} onChange={(v) => setOdc(v === 'odc')} />
              <Button label="Save transport details" kind="soft" onPress={saveDetails} />
            </View>
          </Section>
          <Problems problems={build.problems} ok="Ready to export" />
          <Button label="Export e-way bill file (JSON)" disabled={!!build.problems.length} onPress={exportFile} />
          <Notice tone="primary" title="Generating happens on the portal" body={`${STOPS} Use the e-way bill portal’s bulk generation, then record the 12-digit number it gives.`} />
          <Section title="Record the number">
            <View style={{ gap: 10 }}>
              <NumberField label="E-way bill number (12 digits)" value={ewb} onChange={(t) => setEwb(t.slice(0, 12))} />
              <Field label="Valid until (optional)" value={valid} onChangeText={setValid} placeholder="YYYY-MM-DD" />
              <Button label="Record e-way bill" kind="outline" disabled={ewb.length !== 12} onPress={record} />
            </View>
          </Section>
        </>
      ) : null}
    </View>
  )
}
