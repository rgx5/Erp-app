import React from 'react'
import { Linking, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { Button } from '@/ui/Button'
import { Field, Segmented } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { MapPin, MessageCircle, Phone } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { reportText, VISIT_LABEL, visitMinutes } from '@/modules/services/logic/visits'
import { PhotoStrip } from '@/modules/services/ui/Photos'
import { SignaturePad, SignatureView } from '@/modules/services/ui/Signature'
import type { FieldVisit, VisitSignature } from '@/modules/services/types'
import { VISIT_TONE, whatsApp, shareText } from '@/modules/services/ui/common'
import { DeskButton, DeskPage, dtext, KpiStrip, KpiTile, SplitPane, Toolbar } from './kit'

export interface DesktopVisitDetailProps {
  v: FieldVisit; now: number; shop: string; techName: string; pkgs: Array<{ id: string; name: string }>
  place: string; setPlace: (v: string) => void; checking: boolean; setChecking: (v: boolean) => void; doCheckIn: () => void
  summary: string; setSummary: (v: string) => void; workDone: string; setWorkDone: (v: string) => void
  issues: string; setIssues: (v: string) => void; nextSteps: string; setNextSteps: (v: string) => void
  notes: string; setNotes: (v: string) => void; photos: string[]; setPhotos: (v: string[]) => void; saveReport: () => void
  sigKind: VisitSignature['kind']; setSigKind: (v: VisitSignature['kind']) => void; sigName: string; setSigName: (v: string) => void
  strokes: string[]; setStrokes: (v: string[]) => void; saveSignature: () => void
  complete: (packageId?: string) => void
  cancelling: boolean; setCancelling: (v: boolean) => void; reason: string; setReason: (v: string) => void; doCancel: () => void
}

/**
 * The desktop field-visit screen: a toolbar with check-in/cancel, a KPI strip for status and duration, the
 * report and signature on the main pane and the customer/contact details on a side panel — the exact state and
 * handlers (`doCheckIn`, `saveReport`, `saveSignature`, `complete`) the phone `m/services/visits/[id].tsx` holds.
 */
export function DesktopVisitDetail(p: DesktopVisitDetailProps) {
  const { c } = useTheme()
  const router = useRouter()
  const { v, now } = p
  const minutes = visitMinutes(v, now)
  const phone = v.partyPhone

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={v.no}
          subtitle={v.partyName}
          right={(
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {v.status === 'planned' ? <DeskButton label="Edit" onPress={() => router.push({ pathname: '/m/services/visits/new', params: { id: v.id } })} /> : null}
              {v.status === 'planned' ? <DeskButton label="Check in" tone="primary" icon={<MapPin size={14} color={c.onPrimary} />} onPress={() => { p.setPlace(''); p.setChecking(true) }} /> : null}
              {v.status === 'planned' ? <DeskButton label="Cancel" tone="danger" onPress={() => { p.setReason(''); p.setCancelling(true) }} /> : null}
            </View>
          )}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Status" value={VISIT_LABEL[v.status]} tone={VISIT_TONE[v.status]} />
        <KpiTile label="Planned" value={fmtDateTime(v.plannedAt)} />
        {minutes !== null ? <KpiTile label="Duration" value={`${minutes} min`} tone="success" /> : null}
      </KpiStrip>

      <SplitPane widths={['flex', 320]}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          {v.status === 'checked_in' || v.status === 'completed' ? (
            <Card style={{ gap: 12 }}>
              <T style={[dtext.label, { color: c.inkMute }]}>Report</T>
              <Field label="Summary" value={p.summary} onChangeText={p.setSummary} multiline autoCapitalize="sentences" editable={v.status === 'checked_in'} />
              <Field label="Work done (optional)" value={p.workDone} onChangeText={p.setWorkDone} multiline autoCapitalize="sentences" editable={v.status === 'checked_in'} />
              <Field label="Issues found (optional)" value={p.issues} onChangeText={p.setIssues} multiline autoCapitalize="sentences" editable={v.status === 'checked_in'} />
              <Field label="Next steps (optional)" value={p.nextSteps} onChangeText={p.setNextSteps} multiline autoCapitalize="sentences" editable={v.status === 'checked_in'} />
              <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline editable={v.status === 'checked_in'} />
              <PhotoStrip photos={p.photos} onChange={p.setPhotos} readOnly={v.status !== 'checked_in'} />
              {v.status === 'checked_in' ? <DeskButton label="Save report" onPress={p.saveReport} /> : null}
            </Card>
          ) : null}

          {v.status === 'checked_in' ? (
            <Card style={{ gap: 12 }}>
              <T style={[dtext.label, { color: c.inkMute }]}>Signature</T>
              <Segmented value={p.sigKind} onChange={p.setSigKind} options={[{ value: 'typed', label: 'Typed name' }, { value: 'drawn', label: 'Drawn' }]} />
              <Field label="Name" value={p.sigName} onChangeText={p.setSigName} autoCapitalize="words" />
              {p.sigKind === 'drawn' ? <SignaturePad strokes={p.strokes} onChange={p.setStrokes} /> : null}
              <DeskButton label="Save signature" onPress={p.saveSignature} />
            </Card>
          ) : v.signature ? (
            <Card style={{ gap: 8, alignItems: 'center' }}>
              <T style={[dtext.label, { color: c.inkMute, alignSelf: 'flex-start' }]}>Signed</T>
              {v.signature.kind === 'drawn' && v.signature.strokes ? <SignatureView strokes={v.signature.strokes} width={v.signature.width} height={v.signature.height} /> : null}
              <T v="caption" tone="mute">{v.signature.name} · {fmtDateTime(v.signature.signedAt)}</T>
            </Card>
          ) : null}

          {v.status === 'checked_in' ? (
            <View style={{ gap: 10 }}>
              <Button label="Complete visit" block disabled={!p.summary.trim()} onPress={() => p.complete()} />
              {p.pkgs.map((pk) => <Button key={pk.id} label={`Use a session of ${pk.name}`} kind="soft" block disabled={!p.summary.trim()} onPress={() => p.complete(pk.id)} />)}
            </View>
          ) : null}
        </ScrollView>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <Card>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Badge tone={VISIT_TONE[v.status]}>{VISIT_LABEL[v.status]}</Badge></View>
            <View style={{ marginTop: 8 }}>
              <KV k="Planned" v={fmtDateTime(v.plannedAt)} />
              <KV k="Visiting" v={p.techName} />
              {v.address ? <KV k="Address" v={v.address} /> : null}
              {v.purpose ? <KV k="Purpose" v={v.purpose} /> : null}
              {v.checkInAt ? <KV k="Checked in" v={`${fmtDateTime(v.checkInAt)}${v.checkInPlace ? ` · ${v.checkInPlace}` : ''}`} /> : null}
              {v.checkOutAt ? <KV k="Finished" v={fmtDateTime(v.checkOutAt)} /> : null}
            </View>
            {phone ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button label="Call" kind="soft" size="sm" icon={<Phone size={15} color={c.primary} />} onPress={() => void Linking.openURL(`tel:${phone}`)} />
                {v.status === 'completed' ? <Button label="Share report" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(reportText(v, p.shop, p.techName), phone)} /> : null}
              </View>
            ) : v.status === 'completed' ? <Button label="Share report" kind="soft" size="sm" style={{ marginTop: 12 }} onPress={() => void shareText(reportText(v, p.shop, p.techName))} /> : null}
          </Card>

          {v.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: v.customerId as string } } as never)} /> : null}
        </ScrollView>
      </SplitPane>

      <Sheet visible={p.checking} onClose={() => p.setChecking(false)} title="Check in" footer={<Button label="Check in" size="lg" block onPress={p.doCheckIn} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field label="Where are you" value={p.place} onChangeText={p.setPlace} autoCapitalize="sentences" placeholder="Customer's shop, Andheri" />
          <T v="caption" tone="mute">The browser does not read the device&apos;s location on its own, so type the place.</T>
        </View>
      </Sheet>
      <Sheet visible={p.cancelling} onClose={() => p.setCancelling(false)} title="Cancel the visit" footer={<Button label="Confirm" kind="danger" size="lg" block onPress={p.doCancel} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}><Field label="Why (optional)" value={p.reason} onChangeText={p.setReason} autoCapitalize="sentences" /></View>
      </Sheet>
    </DeskPage>
  )
}
