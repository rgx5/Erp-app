import React, { useState } from 'react'
import { Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { MapPin, MessageCircle, Pencil, Phone } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { reportText, VISIT_LABEL, visitMinutes } from '@/modules/services/logic/visits'
import { usableFor } from '@/modules/services/logic/packages'
import { cancelVisit, checkIn, completeVisit, saveVisitReport, signVisit } from '@/modules/services/ops'
import { PhotoStrip } from '@/modules/services/ui/Photos'
import { SignaturePad, SignatureView } from '@/modules/services/ui/Signature'
import type { VisitSignature } from '@/modules/services/types'
import { act, Denied, useShopName, VISIT_TONE, whatsApp, shareText } from '@/modules/services/ui/common'

/** A field visit: check in, write the report, get it signed, and finish. */
export default function VisitView() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const shop = useShopName()
  const now = Date.now()
  const v = data.fieldVisits?.[id]

  const [place, setPlace] = useState('')
  const [checking, setChecking] = useState(false)
  const [summary, setSummary] = useState(v?.report.summary ?? '')
  const [workDone, setWorkDone] = useState(v?.report.workDone ?? '')
  const [issues, setIssues] = useState(v?.report.issues ?? '')
  const [nextSteps, setNextSteps] = useState(v?.report.nextSteps ?? '')
  const [notes, setNotes] = useState(v?.notes ?? '')
  const [photos, setPhotos] = useState<string[]>(v?.photos ?? [])
  const [sigKind, setSigKind] = useState<VisitSignature['kind']>(v?.signature?.kind ?? 'typed')
  const [sigName, setSigName] = useState(v?.signature?.name ?? '')
  const [strokes, setStrokes] = useState<string[]>(v?.signature?.strokes ?? [])
  const [cancelling, setCancelling] = useState(false)
  const [reason, setReason] = useState('')

  if (!can) return <Denied title="Field visit" who="Field visits are for people who work at the counter." />
  if (!v) return <Screen title="Not found" back><T tone="mute">This visit is no longer here.</T></Screen>
  const minutes = visitMinutes(v, now)
  const phone = v.partyPhone
  const pkgs = v.customerId ? usableFor(data, v.customerId, now) : []

  function doCheckIn() { if (act((s, ctx) => checkIn(s, v!.id, { place }, ctx), 'Checked in')) setChecking(false) }
  function saveReport() { act((s, ctx) => saveVisitReport(s, v!.id, { notes, report: { summary, workDone, issues, nextSteps }, photos }, ctx), 'Saved') }
  function saveSignature() {
    act((s, ctx) => signVisit(s, v!.id, sigKind === 'drawn' ? { kind: 'drawn', name: sigName, strokes, width: 300, height: 140 } : { kind: 'typed', name: sigName }, ctx), 'Signed')
  }
  function complete(packageId?: string) { act((s, ctx) => completeVisit(s, v!.id, ctx, packageId ? { packageId } : {}), 'Visit completed') }
  function doCancel() { if (act((s, ctx) => cancelVisit(s, v!.id, reason, ctx), 'Cancelled')) setCancelling(false) }

  return (
    <Screen title={v.no} subtitle={v.partyName} back
      right={v.status === 'planned' ? <Button label="Edit" kind="soft" size="sm" icon={<Pencil size={15} color={c.primary} />} onPress={() => router.push({ pathname: '/m/services/visits/new', params: { id: v.id } })} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Badge tone={VISIT_TONE[v.status]}>{VISIT_LABEL[v.status]}</Badge></View>
          <View style={{ marginTop: 8 }}>
            <KV k="Planned" v={fmtDateTime(v.plannedAt)} />
            <KV k="Visiting" v={data.users[v.userId]?.name ?? '—'} />
            {v.address ? <KV k="Address" v={v.address} /> : null}
            {v.purpose ? <KV k="Purpose" v={v.purpose} /> : null}
            {v.checkInAt ? <KV k="Checked in" v={`${fmtDateTime(v.checkInAt)}${v.checkInPlace ? ` · ${v.checkInPlace}` : ''}`} /> : null}
            {v.checkOutAt ? <KV k="Finished" v={fmtDateTime(v.checkOutAt)} /> : null}
            {minutes !== null ? <KV k="Duration" v={`${minutes} min`} /> : null}
          </View>
          {phone ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button label="Call" kind="soft" size="sm" icon={<Phone size={15} color={c.primary} />} onPress={() => void Linking.openURL(`tel:${phone}`)} />
              {v.status === 'completed' ? <Button label="Share report" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(reportText(v, shop, data.users[v.userId]?.name ?? ''), phone)} /> : null}
            </View>
          ) : v.status === 'completed' ? <Button label="Share report" kind="soft" size="sm" style={{ marginTop: 12 }} onPress={() => void shareText(reportText(v, shop, data.users[v.userId]?.name ?? ''))} /> : null}
        </Card>

        {v.status === 'planned' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Check in" icon={<MapPin size={16} color={c.onPrimary} />} onPress={() => { setPlace(''); setChecking(true) }} />
            <Button label="Cancel" kind="ghost" onPress={() => { setReason(''); setCancelling(true) }} />
          </View>
        ) : null}

        {v.status === 'checked_in' || v.status === 'completed' ? (
          <Section title="Report" style={{ marginTop: 0 }}>
            <View style={{ gap: 12 }}>
              <Field label="Summary" value={summary} onChangeText={setSummary} multiline autoCapitalize="sentences" editable={v.status === 'checked_in'} />
              <Field label="Work done (optional)" value={workDone} onChangeText={setWorkDone} multiline autoCapitalize="sentences" editable={v.status === 'checked_in'} />
              <Field label="Issues found (optional)" value={issues} onChangeText={setIssues} multiline autoCapitalize="sentences" editable={v.status === 'checked_in'} />
              <Field label="Next steps (optional)" value={nextSteps} onChangeText={setNextSteps} multiline autoCapitalize="sentences" editable={v.status === 'checked_in'} />
              <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline editable={v.status === 'checked_in'} />
              <PhotoStrip photos={photos} onChange={setPhotos} readOnly={v.status !== 'checked_in'} />
              {v.status === 'checked_in' ? <Button label="Save report" kind="soft" onPress={saveReport} /> : null}
            </View>
          </Section>
        ) : null}

        {v.status === 'checked_in' ? (
          <Section title="Signature" style={{ marginTop: 0 }}>
            <View style={{ gap: 12 }}>
              <Segmented value={sigKind} onChange={setSigKind} options={[{ value: 'typed', label: 'Typed name' }, { value: 'drawn', label: 'Drawn' }]} />
              <Field label="Name" value={sigName} onChangeText={setSigName} autoCapitalize="words" />
              {sigKind === 'drawn' ? <SignaturePad strokes={strokes} onChange={setStrokes} /> : null}
              <Button label="Save signature" kind="soft" onPress={saveSignature} />
            </View>
          </Section>
        ) : v.signature ? (
          <Section title="Signed" style={{ marginTop: 0 }}>
            <View style={{ gap: 8, alignItems: 'center' }}>
              {v.signature.kind === 'drawn' && v.signature.strokes ? <SignatureView strokes={v.signature.strokes} width={v.signature.width} height={v.signature.height} /> : null}
              <T v="caption" tone="mute">{v.signature.name} · {fmtDateTime(v.signature.signedAt)}</T>
            </View>
          </Section>
        ) : null}

        {v.status === 'checked_in' ? (
          <Section title="Finish" style={{ marginTop: 0 }}>
            <View style={{ gap: 10 }}>
              <Button label="Complete visit" block disabled={!summary.trim()} onPress={() => complete()} />
              {pkgs.map((p) => <Button key={p.id} label={`Use a session of ${p.name}`} kind="soft" block disabled={!summary.trim()} onPress={() => complete(p.id)} />)}
            </View>
          </Section>
        ) : null}

        {v.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: v.customerId as string } } as never)} /> : null}
      </View>

      <Sheet visible={checking} onClose={() => setChecking(false)} title="Check in" footer={<Button label="Check in" size="lg" block onPress={doCheckIn} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field label="Where are you" value={place} onChangeText={setPlace} autoCapitalize="sentences" placeholder="Customer's shop, Andheri" />
          <T v="caption" tone="mute">The phone does not read the device&apos;s location on its own, so type the place.</T>
        </View>
      </Sheet>
      <Sheet visible={cancelling} onClose={() => setCancelling(false)} title="Cancel the visit" footer={<Button label="Confirm" kind="danger" size="lg" block onPress={doCancel} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}><Field label="Why (optional)" value={reason} onChangeText={setReason} autoCapitalize="sentences" /></View>
      </Sheet>
    </Screen>
  )
}
