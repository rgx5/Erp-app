import React, { useState } from 'react'
import { Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDateTime, fmtLongDate, fmtTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { paymentMethodList } from '@/modules/registry'
import { Button } from '@/ui/Button'
import { Field, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { KV, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Gift, MessageCircle, Pencil, Phone, ReceiptText } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { APPT_LABEL, apptTitle, apptTotal, canEditAppt, confirmationText, missedText, nextApptStatuses, reminderText } from '@/modules/services/logic/appointments'
import { packagePlanLabel, usableFor } from '@/modules/services/logic/packages'
import { billAppointment, completeWithPackage, markReminded, setAppointmentStatus } from '@/modules/services/ops'
import { act, APPT_TONE, Denied, shareText, useShopName, whatsApp } from '@/modules/services/ui/common'
import type { ApptStatus } from '@/modules/services/types'

type Mode = 'cash' | 'upi' | 'card' | 'due'

/** One booking: its status, the reminder text to send, and how it gets paid (a bill, or a session of the customer's package). */
export default function AppointmentView() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const shop = useShopName()
  const a = data.appointments?.[id]
  const [reason, setReason] = useState('')
  const [to, setTo] = useState<ApptStatus | null>(null)
  const [paying, setPaying] = useState(false)
  const [mode, setMode] = useState<Mode>('cash')

  if (!can) return <Denied title="Appointment" who="Appointments are for people who work at the counter." />
  if (!a) return <Screen title="Not found" back><T tone="mute">This appointment is no longer here.</T></Screen>
  const res = data.serviceResources?.[a.resourceId]
  const bill = a.billId ? data.bills[a.billId] : undefined
  const total = apptTotal(a)
  const pkgs = a.customerId ? usableFor(data, a.customerId, Date.now(), a.services.map((s) => s.variantId)) : []
  const paid = !!(a.billId || a.packageUseId)
  const hasDue = paymentMethodList().some((m) => m.id === 'due') && !!a.customerId
  const reminder = reminderText(data, a, shop)
  const phone = a.partyPhone

  const move = (next: ApptStatus, why?: string) => {
    if (act((s, ctx) => setAppointmentStatus(s, a.id, next, ctx, { reason: why }))) { setTo(null); setReason('') }
  }
  function sendReminder() {
    void whatsApp(reminder, phone)
    if (!a!.remindedAt) act((s, ctx) => markReminded(s, a!.id, ctx))
  }
  function bill_() {
    const r = act((s, ctx) => billAppointment(s, a!.id, [{ mode, amount: total }], ctx), 'Billed')
    if (r) { setPaying(false); router.push({ pathname: '/bills/[id]', params: { id: r.bill.id } } as never) }
  }

  return (
    <Screen title={apptTitle(a)} subtitle={`${a.no} · ${a.partyName}`} back
      right={canEditAppt(a) ? <Button label="Change" kind="soft" size="sm" icon={<Pencil size={15} color={c.primary} />} onPress={() => router.push({ pathname: '/m/services/appointments/new', params: { id: a.id } })} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={APPT_TONE[a.status]}>{APPT_LABEL[a.status]}</Badge>
            {a.remindedAt ? <Badge tone="success">Reminded</Badge> : null}
            {a.billId ? <Badge tone="success">Billed</Badge> : null}
            {a.packageUseId ? <Badge tone="accent">Paid by package</Badge> : null}
          </View>
          <View style={{ marginTop: 8 }}>
            <KV k="When" v={`${fmtLongDate(a.start)}, ${fmtTime(a.start)}–${fmtTime(a.end)}`} />
            <KV k="With" v={res?.name ?? '—'} />
            <KV k="Customer" v={a.partyName} />
            {phone ? <KV k="Mobile" v={phone} /> : null}
            {a.notes ? <KV k="Notes" v={a.notes} /> : null}
            {a.cancelReason ? <KV k="Cancelled because" v={a.cancelReason} tone="warning" /> : null}
            {bill ? <KV k="Bill" v={bill.no} /> : null}
          </View>
          {phone ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button label="Call" kind="soft" size="sm" icon={<Phone size={15} color={c.primary} />} onPress={() => void Linking.openURL(`tel:${phone}`)} />
              <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(confirmationText(data, a, shop), phone)} />
            </View>
          ) : null}
        </Card>

        <Section title="Services" style={{ marginTop: 0 }}>
          <Card padded={false}>
            {a.services.map((s, i) => <ListRow key={`${s.variantId}${i}`} title={s.name} subtitle={`${s.durationMin} min`} value={inr(s.price, 0)} />)}
            <ListRow title="Total" value={inr(total, 0)} />
          </Card>
        </Section>

        {a.status === 'booked' || a.status === 'confirmed' ? (
          <Section title="Reminder" style={{ marginTop: 0 }}>
            <Card>
              <T v="caption" tone="soft">{reminder}</T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Button label={phone ? 'Send on WhatsApp' : 'Share text'} kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => (phone ? sendReminder() : void shareText(reminder))} />
                {a.remindedAt ? <T v="caption" tone="mute" style={{ alignSelf: 'center' }}>Last sent {fmtDateTime(a.remindedAt)}</T> : null}
              </View>
            </Card>
          </Section>
        ) : null}

        {a.status === 'no_show' && phone ? <Button label="Send a “we missed you” text" kind="outline" block onPress={() => void whatsApp(missedText(a, shop), phone)} /> : null}

        {nextApptStatuses(a.status).length ? (
          <Section title="Move it along" style={{ marginTop: 0 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {nextApptStatuses(a.status).map((s) => (
                <Chip key={s} label={s === 'booked' ? 'Back to booked' : s === 'no_show' ? 'Did not come' : s === 'completed' ? 'Done, no charge' : APPT_LABEL[s]} tone={s === 'no_show' || s === 'cancelled' ? 'danger' : undefined}
                  onPress={() => (s === 'cancelled' || s === 'no_show' ? setTo(s) : move(s))} />
              ))}
            </View>
          </Section>
        ) : null}

        {!paid && a.status !== 'cancelled' && a.status !== 'no_show' ? (
          <Section title="Take payment" style={{ marginTop: 0 }}>
            <Card padded={false}>
              <ListRow icon={<ReceiptText size={18} color={c.primary} />} title="Make the bill" subtitle={`${inr(total, 0)} · cash, UPI or card`} onPress={() => setPaying(true)} />
              {pkgs.map((p) => (
                <ListRow key={p.id} icon={<Gift size={18} color={c.accent} />} iconTone="accent" title={`Use a session of ${p.name}`} subtitle={packagePlanLabel(p)}
                  onPress={() => { if (act((s, ctx) => completeWithPackage(s, a.id, p.id, ctx), 'Session used')) toast('Done', 'ok') }} />
              ))}
            </Card>
          </Section>
        ) : null}

        {a.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: a.customerId as string } } as never)} /> : null}
      </View>

      <Sheet visible={paying} onClose={() => setPaying(false)} title={`Bill ${inr(total, 0)}`} footer={<Button label="Make the bill" size="lg" block onPress={bill_} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, ...(hasDue ? [{ value: 'due' as const, label: 'On account' }] : [])]} />
          <T v="caption" tone="mute">The bill is made like any other: GST, the next invoice number, and loyalty points for the customer.</T>
        </View>
      </Sheet>

      <Sheet visible={!!to} onClose={() => setTo(null)} title={to === 'no_show' ? 'Did not come' : 'Cancel the appointment'} footer={<Button label="Confirm" size="lg" block onPress={() => to && move(to, reason)} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field label={to === 'no_show' ? 'Note (optional)' : 'Why? (optional)'} value={reason} onChangeText={setReason} autoCapitalize="sentences" />
          {to === 'no_show' ? <T v="caption" tone="mute">After the shop&apos;s limit of no-shows, this customer needs a manager to book again.</T> : null}
        </View>
      </Sheet>
    </Screen>
  )
}

