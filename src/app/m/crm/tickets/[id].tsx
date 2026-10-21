import React, { useState } from 'react'
import { Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import { perform, useApp, useCan } from '@/data/store'
import { whatsApp } from '@/features/share'
import { Button } from '@/ui/Button'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { MessageCircle, Phone } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { assignTicket, moveTicket, setTicketPriority } from '@/modules/crm/ops'
import { settingsOf } from '@/modules/crm/settings'
import { isOpenTicket, KIND_LABEL, nextStatuses, OUTCOME_LABEL, PRIORITY_LABEL, slaLabel, slaState, STATUS_LABEL, warrantyCover } from '@/modules/crm/tickets'
import type { TicketPriority, TicketStatus, WarrantyOutcome } from '@/modules/crm/types'
import { failWith } from '@/modules/crm/ui/forms'
import { PRIORITY_TONE, SLA_TONE, STATUS_TONE } from '@/modules/crm/ui/tones'
import { NotesSection, TasksSection } from '@/modules/crm/ui/Work'

/** One ticket: its status flow, due time, warranty cover and history. */
export default function TicketView() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('customers')
  const data = useApp((s) => s.data)
  const t = data.crmTickets?.[id]
  const [to, setTo] = useState<TicketStatus | null>(null)
  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState('')
  const [outcome, setOutcome] = useState<WarrantyOutcome | ''>('')

  if (!can) return <Screen title="Ticket" back><T tone="mute">Tickets are for people who use the billing counter.</T></Screen>
  if (!t) return <Screen title="Not found" back><T tone="mute">This ticket is no longer here.</T></Screen>
  const now = Date.now()
  const open = isOpenTicket(t)
  const bill = t.billId ? data.bills[t.billId] : undefined
  const cover = bill && t.kind === 'warranty' ? warrantyCover(bill.date, settingsOf(data).warrantyMonths, t.openedAt) : null
  const team = Object.values(data.users).filter((u) => u.active)

  function go() {
    try {
      perform((s, ctx) => moveTicket(s, t!.id, to as TicketStatus, { note, resolution, ...(outcome ? { outcome } : {}) }, ctx))
      setTo(null); setNote(''); setResolution(''); setOutcome('')
    } catch (e) { failWith(e) }
  }
  const pick = (s: TicketStatus) => { setResolution(t!.resolution); setOutcome(t!.outcome ?? ''); setTo(s) }
  const msg = `Hello ${t.partyName.split(' ')[0]}, about your ${KIND_LABEL[t.kind].toLowerCase()} ${t.no} (“${t.subject}”): `

  return (
    <Screen title={t.subject} subtitle={`${t.no} · ${KIND_LABEL[t.kind]}`} back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
            <Badge tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]} priority</Badge>
            <Badge tone={SLA_TONE[slaState(t, now)]}>{slaLabel(t, now)}</Badge>
          </View>
          <View style={{ marginTop: 8 }}>
            <KV k="Customer" v={t.partyName} />
            {t.partyPhone ? <KV k="Mobile" v={t.partyPhone} /> : null}
            <KV k="Opened" v={fmtDateTime(t.openedAt)} />
            <KV k={open ? 'To settle by' : 'Due was'} v={fmtDateTime(t.slaDue)} />
            {t.itemName ? <KV k="Product" v={t.itemName} /> : null}
            {t.serial ? <KV k="Serial" v={t.serial} /> : null}
            {bill ? <KV k="Bill" v={`${bill.no} · ${fmtDate(bill.date)}`} /> : null}
            {cover ? <KV k="Warranty" v={cover.covered ? `In warranty until ${fmtDate(cover.endsAt)}` : `Ended ${fmtDate(cover.endsAt)}`} tone={cover.covered ? 'success' : 'warning'} /> : null}
            {t.description ? <KV k="Details" v={t.description} /> : null}
            {t.resolution ? <KV k="Resolution" v={t.resolution} /> : null}
            {t.outcome ? <KV k="Outcome" v={OUTCOME_LABEL[t.outcome]} /> : null}
          </View>
          {t.partyPhone ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button label="Call" kind="soft" size="sm" icon={<Phone size={15} color={c.primary} />} onPress={() => void Linking.openURL(`tel:${t.partyPhone}`)} />
              <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(msg, t.partyPhone)} />
            </View>
          ) : null}
        </Card>

        <Section title={open ? 'Move it along' : 'Status'} style={{ marginTop: 0 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {nextStatuses(t.status).map((s) => <Chip key={s} label={s === 'open' ? 'Reopen' : STATUS_LABEL[s]} onPress={() => pick(s)} />)}
          </View>
        </Section>

        {open ? (
          <View style={{ gap: 12 }}>
            <Segmented value={t.priority} onChange={(p: TicketPriority) => { try { perform((s, ctx) => setTicketPriority(s, t.id, p, ctx)) } catch (e) { failWith(e) } }}
              options={(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
            {team.length > 1 ? <Select label="Looked after by" value={t.assignedTo ?? ''} placeholder="Nobody yet" options={[{ value: '', label: 'Nobody yet' }, ...team.map((u) => ({ value: u.id, label: u.name }))]}
              onChange={(v) => { try { perform((s, ctx) => assignTicket(s, t.id, v || null, ctx)) } catch (e) { failWith(e) } }} /> : null}
          </View>
        ) : null}

        {t.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/m/crm/customer/[id]', params: { id: t.customerId as string } })} /> : null}
        <TasksSection target={{ ticketId: t.id }} />
        <NotesSection target={{ ticketId: t.id }} title="History & notes" />
      </View>

      <Sheet visible={!!to} onClose={() => setTo(null)} title={to ? (to === 'open' ? 'Reopen the ticket' : `Mark ${STATUS_LABEL[to].toLowerCase()}`) : ''} full={to === 'resolved'}
        footer={<Button label="Save" size="lg" block onPress={go} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          {to === 'resolved' ? (
            <>
              <Field label="How was it resolved?" value={resolution} onChangeText={setResolution} multiline autoCapitalize="sentences" />
              {t.kind === 'warranty' ? <Select label="Outcome of the claim" value={outcome} placeholder="Choose" options={(Object.keys(OUTCOME_LABEL) as WarrantyOutcome[]).map((o) => ({ value: o, label: OUTCOME_LABEL[o] }))} onChange={setOutcome} /> : null}
            </>
          ) : null}
          <Field label="Note (optional)" value={note} onChangeText={setNote} autoCapitalize="sentences" />
          {to === 'open' ? <T v="caption" tone="mute">Reopening starts the due time again from now.</T> : null}
        </View>
      </Sheet>
    </Screen>
  )
}
