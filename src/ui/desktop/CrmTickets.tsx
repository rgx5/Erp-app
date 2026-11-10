import React, { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { listOf } from '@/data/state'
import { perform, useApp, useCan } from '@/data/store'
import { whatsApp } from '@/features/share'
import { assignTicket, moveTicket, setTicketPriority } from '@/modules/crm/ops'
import { settingsOf } from '@/modules/crm/settings'
import {
  isOpenTicket, KIND_LABEL, nextStatuses, OUTCOME_LABEL, PRIORITY_LABEL, slaLabel, slaState, STATUS_LABEL, ticketSummary, warrantyCover,
} from '@/modules/crm/tickets'
import type { Customer } from '@/domain/types'
import type { Ticket, TicketKind, TicketPriority, TicketStatus, WarrantyOutcome } from '@/modules/crm/types'
import { CustomerField, failWith } from '@/modules/crm/ui/forms'
import { PRIORITY_TONE, SLA_TONE, STATUS_TONE } from '@/modules/crm/ui/tones'
import { NotesSection, TasksSection } from '@/modules/crm/ui/Work'
import { Button } from '@/ui/Button'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { MessageCircle, Phone, Plus, Search as SearchIcon } from '@/ui/icons'
import { fonts, useTheme } from '@/ui/theme'
import {
  cellText, DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar, type Column,
} from './kit'
import { DesktopSettingsPage } from './SettingsPage'

type Filter = 'open' | 'late' | 'settled' | TicketKind
type Row = { id: string; subject: string; no: string; party: string; kind: TicketKind; status: TicketStatus; priority: TicketPriority; sla: string; slaTone: ReturnType<typeof slaState>; slaDue: number }

/**
 * The desktop Complaints & warranty screen: a KPI strip (open, past due time), a search bar and filter chips, and
 * one dense sortable grid instead of two scrolling card lists. Reads its own data directly, exactly like
 * `DesktopPurchases`: every figure comes from the same `ticketSummary`/`slaState` the phone `m/crm/tickets/index.tsx` calls.
 */
export function DesktopTickets() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('customers')
  const tickets = useList('crmTickets')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const now = Date.now()
  const sum = useMemo(() => ticketSummary(data, now), [data, now])
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return tickets
      .filter((t) => (filter === 'open' ? isOpenTicket(t) : filter === 'late' ? slaState(t, now) === 'breached' : filter === 'settled' ? !isOpenTicket(t) : t.kind === filter))
      .filter((t) => !n || t.no.toLowerCase().includes(n) || t.partyName.toLowerCase().includes(n) || t.subject.toLowerCase().includes(n))
  }, [tickets, q, filter, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Complaints & warranty" />}>
        <View style={{ padding: 20 }}><T tone="mute">Tickets are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

  const rows: Row[] = filtered.map((t) => ({ id: t.id, subject: t.subject, no: t.no, party: t.partyName, kind: t.kind, status: t.status, priority: t.priority, sla: slaLabel(t, now), slaTone: slaState(t, now), slaDue: t.slaDue }))

  const columns: Array<Column<Row>> = [
    { key: 'subject', label: 'Ticket', sortValue: (r) => r.subject, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.subject}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.no} · {r.party} · {KIND_LABEL[r.kind]}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 110, sortValue: (r) => r.status, render: (r) => <Pill tone={STATUS_TONE[r.status]} label={STATUS_LABEL[r.status]} /> },
    { key: 'priority', label: 'Priority', width: 90, sortValue: (r) => r.priority, render: (r) => (r.priority === 'high' ? <Pill tone={PRIORITY_TONE.high} label="High" /> : cellText(PRIORITY_LABEL[r.priority])) },
    { key: 'sla', label: 'Due', width: 150, sortValue: (r) => r.slaDue, render: (r) => <Pill tone={SLA_TONE[r.slaTone]} label={r.sla} /> },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Complaints & warranty"
          subtitle={`${tickets.length} in all`}
          right={<DeskButton label="New ticket" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/crm/tickets/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Open" value={String(sum.open)} delta={sum.dueSoon ? `${sum.dueSoon} due soon` : 'None due soon'} onPress={() => setFilter('open')} />
        <KpiTile label="Past due time" value={String(sum.breached)} tone={sum.breached ? 'danger' : 'success'} delta={sum.slaMetPct === null ? 'No settled tickets yet' : `${sum.slaMetPct}% settled in time`} onPress={() => setFilter('late')} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 360, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search number, customer or problem" placeholderTextColor={c.inkMute} autoCorrect={false} autoCapitalize="none" style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {([['open', 'Open'], ['late', 'Late'], ['complaint', 'Complaints'], ['service', 'After-sales'], ['warranty', 'Warranty'], ['settled', 'Settled']] as Array<[Filter, string]>).map(([id, label]) => (
            <Chip key={id} label={label} selected={filter === id} onPress={() => setFilter(id)} />
          ))}
        </View>
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/crm/tickets/[id]', params: { id: r.id } })} emptyLabel={q || filter !== 'open' ? 'No tickets match' : 'No open tickets'} />
      </View>
    </DeskPage>
  )
}

// ───────────────────────────── tickets/[id].tsx ─────────────────────────────

export interface DesktopTicketViewProps { t: Ticket; bill: { no: string } | undefined; cover: { covered: boolean; endsAt: number } | null; team: Array<{ id: string; name: string }> }

/** The desktop ticket-detail screen: a toolbar, a KPI strip (status/priority/due), the status-change actions, and the same `TasksSection`/`NotesSection` side panel. */
export function DesktopTicketView({ t, bill, cover, team }: DesktopTicketViewProps) {
  const { c } = useTheme()
  const router = useRouter()
  const [to, setTo] = useState<TicketStatus | null>(null)
  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState('')
  const [outcome, setOutcome] = useState<WarrantyOutcome | ''>('')
  const now = Date.now()
  const open = isOpenTicket(t)
  const msg = `Hello ${t.partyName.split(' ')[0]}, about your ${KIND_LABEL[t.kind].toLowerCase()} ${t.no} (“${t.subject}”): `

  function go() {
    try {
      perform((s, ctx) => moveTicket(s, t.id, to as TicketStatus, { note, resolution, ...(outcome ? { outcome } : {}) }, ctx))
      setTo(null); setNote(''); setResolution(''); setOutcome('')
    } catch (e) { failWith(e) }
  }
  const pick = (s: TicketStatus) => { setResolution(t.resolution); setOutcome(t.outcome ?? ''); setTo(s) }

  return (
    <DeskPage toolbar={<Toolbar title={t.subject} subtitle={`${t.no} · ${KIND_LABEL[t.kind]}`} />}>
      <KpiStrip>
        <KpiTile label="Status" value={STATUS_LABEL[t.status]} tone={STATUS_TONE[t.status]} />
        <KpiTile label="Priority" value={PRIORITY_LABEL[t.priority]} tone={PRIORITY_TONE[t.priority]} />
        <KpiTile label={open ? 'To settle by' : 'Due was'} value={fmtDate(t.slaDue)} tone={SLA_TONE[slaState(t, now)]} delta={slaLabel(t, now)} />
      </KpiStrip>

      <View style={{ flex: 1, flexDirection: 'row' }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <KV k="Customer" v={t.partyName} />
            {t.partyPhone ? <KV k="Mobile" v={t.partyPhone} /> : null}
            <KV k="Opened" v={fmtDateTime(t.openedAt)} />
            {t.itemName ? <KV k="Product" v={t.itemName} /> : null}
            {t.serial ? <KV k="Serial" v={t.serial} /> : null}
            {bill ? <KV k="Bill" v={bill.no} /> : null}
            {cover ? <KV k="Warranty" v={cover.covered ? `In warranty until ${fmtDate(cover.endsAt)}` : `Ended ${fmtDate(cover.endsAt)}`} tone={cover.covered ? 'success' : 'warning'} /> : null}
            {t.outcome ? <KV k="Outcome" v={OUTCOME_LABEL[t.outcome]} /> : null}
            {t.description ? <View style={{ marginTop: 6, gap: 2 }}><T style={[dtext.label, { color: c.inkMute }]}>Details</T><T style={dtext.cell}>{t.description}</T></View> : null}
            {t.resolution ? <View style={{ marginTop: 6, gap: 2 }}><T style={[dtext.label, { color: c.inkMute }]}>Resolution</T><T style={dtext.cell}>{t.resolution}</T></View> : null}
            {t.partyPhone ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button label="Call" kind="soft" size="sm" icon={<Phone size={15} color={c.primary} />} onPress={() => void Linking.openURL(`tel:${t.partyPhone}`)} />
                <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(msg, t.partyPhone)} />
              </View>
            ) : null}
          </View>

          <View style={{ gap: 8 }}>
            <T style={[dtext.label, { color: c.inkMute }]}>{open ? 'Move it along' : 'Status'}</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {nextStatuses(t.status).map((s) => <Chip key={s} label={s === 'open' ? 'Reopen' : STATUS_LABEL[s]} onPress={() => pick(s)} />)}
            </View>
          </View>

          {open ? (
            <View style={{ gap: 12 }}>
              <Segmented value={t.priority} onChange={(p: TicketPriority) => { try { perform((s, ctx) => setTicketPriority(s, t.id, p, ctx)) } catch (e) { failWith(e) } }}
                options={(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
              {team.length > 1 ? <Select label="Looked after by" value={t.assignedTo ?? ''} placeholder="Nobody yet" options={[{ value: '', label: 'Nobody yet' }, ...team.map((u) => ({ value: u.id, label: u.name }))]}
                onChange={(v) => { try { perform((s, ctx) => assignTicket(s, t.id, v || null, ctx)) } catch (e) { failWith(e) } }} /> : null}
            </View>
          ) : null}

          {t.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/m/crm/customer/[id]', params: { id: t.customerId as string } })} /> : null}
        </ScrollView>

        <View style={{ width: 360, borderLeftWidth: 1, borderLeftColor: c.line, backgroundColor: c.bg }}>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 14 }}>
            <TasksSection target={{ ticketId: t.id }} />
            <NotesSection target={{ ticketId: t.id }} title="History & notes" />
          </ScrollView>
        </View>
      </View>

      <Sheet visible={!!to} onClose={() => setTo(null)} title={to ? (to === 'open' ? 'Reopen the ticket' : `Mark ${STATUS_LABEL[to].toLowerCase()}`) : ''} full={to === 'resolved'} footer={<Button label="Save" size="lg" block onPress={go} />}>
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
    </DeskPage>
  )
}

// ───────────────────────────── tickets/new.tsx ─────────────────────────────

export interface DesktopTicketNewProps {
  kind: TicketKind; setKind: (v: TicketKind) => void
  customerId: string | undefined; onCustomerChange: (cu: Customer | null) => void
  partyName: string; setPartyName: (v: string) => void
  billId: string; onBillChange: (v: string) => void
  itemName: string; setItemName: (v: string) => void
  serial: string; setSerial: (v: string) => void
  subject: string; setSubject: (v: string) => void
  description: string; setDescription: (v: string) => void
  priority: TicketPriority; setPriority: (v: TicketPriority) => void
  bills: Array<{ id: string; no: string; date: number; total: number; items: Array<{ name: string }> }>
  cover: { covered: boolean; endsAt: number } | null
  warrantyMonths: number
  slaHours: Record<TicketPriority, number>
  onSave: () => void
}

/** The desktop new-ticket form: the same centred-column shell every desktop form uses, around the exact same fields. */
export function DesktopTicketNew(p: DesktopTicketNewProps) {
  return (
    <DesktopSettingsPage title="New ticket" right={<DeskButton label="Open ticket" tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <Segmented value={p.kind} onChange={p.setKind} options={(Object.keys(KIND_LABEL) as TicketKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <CustomerField value={p.customerId} onChange={p.onCustomerChange} />
        {!p.customerId ? <Field label="Or type a name" value={p.partyName} onChangeText={p.setPartyName} autoCapitalize="words" /> : null}
        {p.customerId ? (
          <Select label={p.kind === 'warranty' ? 'Bill of purchase' : 'Bill it is about (optional)'} value={p.billId} placeholder="Choose a bill" searchable
            options={[{ value: '', label: 'No bill' }, ...p.bills.map((b) => ({ value: b.id, label: `${b.no} · ${fmtDate(b.date)}`, sub: `${inr(b.total, 0)} · ${b.items.map((i) => i.name).slice(0, 2).join(', ')}` }))]}
            onChange={p.onBillChange} />
        ) : null}
        {p.kind !== 'complaint' ? <Field label="Product" value={p.itemName} onChangeText={p.setItemName} autoCapitalize="words" /> : null}
        {p.kind === 'warranty' ? <Field label="Serial / IMEI (optional)" value={p.serial} onChangeText={p.setSerial} autoCapitalize="characters" mono /> : null}
        {p.cover ? <Notice tone={p.cover.covered ? 'success' : 'warning'} title={p.cover.covered ? `Under warranty until ${fmtDate(p.cover.endsAt)}` : `Warranty ended on ${fmtDate(p.cover.endsAt)}`} body={`Counted as ${p.warrantyMonths} months from the bill. Change this in the CRM settings.`} /> : null}
        <Field label="What is the problem?" value={p.subject} onChangeText={p.setSubject} autoCapitalize="sentences" />
        <Field label="Details (optional)" value={p.description} onChangeText={p.setDescription} multiline autoCapitalize="sentences" />
        <Segmented value={p.priority} onChange={p.setPriority} options={(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((pr) => ({ value: pr, label: PRIORITY_LABEL[pr] }))} />
        <T v="caption" tone="mute">To be settled within {p.slaHours[p.priority]} hours.</T>
      </View>
    </DesktopSettingsPage>
  )
}
