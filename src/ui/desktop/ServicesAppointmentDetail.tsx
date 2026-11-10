import React from 'react'
import { Linking, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime, fmtLongDate, fmtTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { Button } from '@/ui/Button'
import { Field, Segmented } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Gift, MessageCircle, Phone, ReceiptText } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { APPT_LABEL, apptTitle, canEditAppt, nextApptStatuses } from '@/modules/services/logic/appointments'
import type { usableFor } from '@/modules/services/logic/packages'
import { APPT_TONE, whatsApp, shareText } from '@/modules/services/ui/common'
import type { Appointment, ApptStatus, ServiceResource } from '@/modules/services/types'
import type { Bill } from '@/domain/types'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, SplitPane, Toolbar, cellNum, cellText, type Column } from './kit'

type Mode = 'cash' | 'upi' | 'card' | 'due'
type SvcRow = { id: string; name: string; durationMin: number; price: number }

export interface DesktopAppointmentDetailProps {
  a: Appointment; res: ServiceResource | undefined; bill: Bill | undefined; total: number
  pkgs: ReturnType<typeof usableFor>; paid: boolean; hasDue: boolean; reminder: string; confirmation: string; missed: string; phone: string | undefined
  move: (next: ApptStatus, why?: string) => void; sendReminder: () => void
  reason: string; setReason: (v: string) => void; to: ApptStatus | null; setTo: (v: ApptStatus | null) => void
  paying: boolean; setPaying: (v: boolean) => void; mode: Mode; setMode: (v: Mode) => void; billAppt: () => void
  onUsePackage: (packageId: string) => void
}

/**
 * The desktop appointment screen: a toolbar with the status moves, a KPI strip for the booking's value and
 * duration, a grid of its services, and a side panel for the reminder and payment — mirroring the exact state
 * (`a`, `move`, `billAppt`, …) the phone `m/services/appointments/[id].tsx` already holds.
 */
export function DesktopAppointmentDetail(p: DesktopAppointmentDetailProps) {
  const { c } = useTheme()
  const router = useRouter()
  const { a } = p

  const rows: SvcRow[] = a.services.map((s, i) => ({ id: `${s.variantId}${i}`, name: s.name, durationMin: s.durationMin, price: s.price }))
  const columns: Array<Column<SvcRow>> = [
    { key: 'name', label: 'Service', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'dur', label: 'Duration', width: 110, align: 'right', render: (r) => cellText(`${r.durationMin} min`) },
    { key: 'price', label: 'Price', width: 120, align: 'right', sortValue: (r) => r.price, render: (r) => cellNum(inr(r.price, 0)) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={apptTitle(a)}
          subtitle={`${a.no} · ${a.partyName}`}
          right={(
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {canEditAppt(a) ? <DeskButton label="Change" onPress={() => router.push({ pathname: '/m/services/appointments/new', params: { id: a.id } })} /> : null}
              {nextApptStatuses(a.status).map((s) => (
                <DeskButton key={s} label={s === 'booked' ? 'Back to booked' : s === 'no_show' ? 'Did not come' : s === 'completed' ? 'Done, no charge' : APPT_LABEL[s]}
                  tone={s === 'no_show' || s === 'cancelled' ? 'danger' : 'default'} onPress={() => (s === 'cancelled' || s === 'no_show' ? p.setTo(s) : p.move(s))} />
              ))}
            </View>
          )}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Total" value={inr(p.total, 0)} tone="primary" delta={`${a.services.length} ${a.services.length === 1 ? 'service' : 'services'}`} />
        <KpiTile label="Status" value={APPT_LABEL[a.status]} tone={APPT_TONE[a.status]} delta={`${fmtTime(a.start)}–${fmtTime(a.end)}`} />
      </KpiStrip>

      <SplitPane widths={['flex', 340]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No services on this booking" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <Card>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Badge tone={APPT_TONE[a.status]}>{APPT_LABEL[a.status]}</Badge>
              {a.remindedAt ? <Badge tone="success">Reminded</Badge> : null}
              {a.billId ? <Badge tone="success">Billed</Badge> : null}
              {a.packageUseId ? <Badge tone="accent">Paid by package</Badge> : null}
            </View>
            <View style={{ marginTop: 8 }}>
              <KV k="When" v={`${fmtLongDate(a.start)}, ${fmtTime(a.start)}–${fmtTime(a.end)}`} />
              <KV k="With" v={p.res?.name ?? '—'} />
              <KV k="Customer" v={a.partyName} />
              {p.phone ? <KV k="Mobile" v={p.phone} /> : null}
              {a.notes ? <KV k="Notes" v={a.notes} /> : null}
              {a.cancelReason ? <KV k="Cancelled because" v={a.cancelReason} tone="warning" /> : null}
              {p.bill ? <KV k="Bill" v={p.bill.no} /> : null}
            </View>
            {p.phone ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button label="Call" kind="soft" size="sm" icon={<Phone size={15} color={c.primary} />} onPress={() => void Linking.openURL(`tel:${p.phone}`)} />
                <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(p.confirmation, p.phone)} />
              </View>
            ) : null}
          </Card>

          {a.status === 'booked' || a.status === 'confirmed' ? (
            <Card>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Reminder</T>
              <T v="caption" tone="soft">{p.reminder}</T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Button label={p.phone ? 'Send on WhatsApp' : 'Share text'} kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => (p.phone ? p.sendReminder() : void shareText(p.reminder))} />
                {a.remindedAt ? <T v="caption" tone="mute" style={{ alignSelf: 'center' }}>Last sent {fmtDateTime(a.remindedAt)}</T> : null}
              </View>
            </Card>
          ) : null}

          {a.status === 'no_show' && p.phone ? <Button label="Send a “we missed you” text" kind="outline" block onPress={() => void whatsApp(p.missed, p.phone)} /> : null}

          {!p.paid && a.status !== 'cancelled' && a.status !== 'no_show' ? (
            <Card padded={false}>
              <T style={[dtext.label, { color: c.inkMute, margin: 14, marginBottom: 0 }]}>Take payment</T>
              <View style={{ padding: 14, gap: 10 }}>
                <Button label="Make the bill" kind="soft" icon={<ReceiptText size={16} color={c.primary} />} onPress={() => p.setPaying(true)} />
                {p.pkgs.map((pk) => (
                  <Button key={pk.id} label={`Use a session of ${pk.name}`} kind="soft" icon={<Gift size={16} color={c.accent} />} onPress={() => p.onUsePackage(pk.id)} />
                ))}
              </View>
            </Card>
          ) : null}

          {a.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: a.customerId as string } } as never)} /> : null}
        </ScrollView>
      </SplitPane>

      <Sheet visible={p.paying} onClose={() => p.setPaying(false)} title={`Bill ${inr(p.total, 0)}`} footer={<Button label="Make the bill" size="lg" block onPress={p.billAppt} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Segmented value={p.mode} onChange={p.setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, ...(p.hasDue ? [{ value: 'due' as const, label: 'On account' }] : [])]} />
          <T v="caption" tone="mute">The bill is made like any other: GST, the next invoice number, and loyalty points for the customer.</T>
        </View>
      </Sheet>

      <Sheet visible={!!p.to} onClose={() => p.setTo(null)} title={p.to === 'no_show' ? 'Did not come' : 'Cancel the appointment'} footer={<Button label="Confirm" size="lg" block onPress={() => p.to && p.move(p.to, p.reason)} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field label={p.to === 'no_show' ? 'Note (optional)' : 'Why? (optional)'} value={p.reason} onChangeText={p.setReason} autoCapitalize="sentences" />
          {p.to === 'no_show' ? <T v="caption" tone="mute">After the shop&apos;s limit of no-shows, this customer needs a manager to book again.</T> : null}
        </View>
      </Sheet>
    </DeskPage>
  )
}
