import React, { useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate, fmtDayShort } from '@/domain/dates'
import { inr, inrShort } from '@/domain/money'
import { useList } from '@/data/hooks'
import { perform, useApp, useCan } from '@/data/store'
import { whatsApp } from '@/features/share'
import { followUpState, isOpenLead, pipelineSummary, stagesFrom, STAGES, STAGE_LABEL } from '@/modules/crm/leads'
import { convertLead, deleteLead, moveLead, setFollowUp } from '@/modules/crm/ops'
import { DateField, dateText, dateValue, failWith } from '@/modules/crm/ui/forms'
import { STAGE_TONE } from '@/modules/crm/ui/tones'
import { NotesSection, TasksSection } from '@/modules/crm/ui/Work'
import type { Lead, LeadStage } from '@/modules/crm/types'
import { Button } from '@/ui/Button'
import { Field, MoneyField, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ask, toast } from '@/ui/overlays'
import { Check, MessageCircle, Phone, Plus, Search as SearchIcon, Trash } from '@/ui/icons'
import { fonts, useTheme } from '@/ui/theme'
import {
  cellNum, cellText, DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar, type Column,
} from './kit'
import { DesktopSettingsPage } from './SettingsPage'

type Filter = 'open' | 'due' | LeadStage
type Row = { id: string; name: string; no: string; sub: string; stage: LeadStage; follow: 'none' | 'overdue' | 'today' | 'later'; followAt?: number; value: number }

const SOURCES = ['Walk-in', 'Referral', 'Instagram', 'WhatsApp', 'Phone call', 'Website']

/**
 * The desktop Leads & pipeline screen: a KPI strip (open value, won value), a search bar with the same filter chips
 * as the phone screen, and one dense sortable grid instead of a scrolling card list. Reads its own data directly,
 * exactly like `DesktopPurchases`: every figure comes from the same `pipelineSummary`/`followUpState`/`isOpenLead`
 * the phone `m/crm/leads/index.tsx` calls.
 */
export function DesktopLeads() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('customers')
  const leads = useList('crmLeads')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('open')
  const now = Date.now()
  const pipe = useMemo(() => pipelineSummary(data, now), [data, now])
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase()
    return leads
      .filter((l) => (filter === 'open' ? isOpenLead(l) : filter === 'due' ? ['overdue', 'today'].includes(followUpState(l, now)) : l.stage === filter))
      .filter((l) => !n || l.name.toLowerCase().includes(n) || l.phone.includes(n) || l.no.toLowerCase().includes(n) || l.source.toLowerCase().includes(n))
  }, [leads, q, filter, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Leads & pipeline" />}>
        <View style={{ padding: 20 }}><T tone="mute">Leads are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

  const dueCount = pipe.overdue + pipe.dueToday
  const rows: Row[] = filtered.map((l) => ({ id: l.id, name: l.name, no: l.no, sub: [l.source, l.phone].filter(Boolean).join(' · '), stage: l.stage, follow: followUpState(l, now), followAt: l.nextFollowUp, value: l.value }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Lead', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.no}{r.sub ? ` · ${r.sub}` : ''}</T>
      </View>
    ) },
    { key: 'stage', label: 'Stage', width: 120, sortValue: (r) => r.stage, render: (r) => <Pill tone={STAGE_TONE[r.stage]} label={STAGE_LABEL[r.stage]} /> },
    { key: 'follow', label: 'Follow-up', width: 150, sortValue: (r) => r.followAt ?? Infinity, render: (r) => (
      r.follow === 'overdue' ? <Pill tone="danger" label={`Late · ${fmtDayShort(r.followAt as number)}`} /> : r.follow === 'today' ? <Pill tone="warning" label="Today" /> : r.follow === 'later' ? <Pill label={fmtDayShort(r.followAt as number)} /> : null
    ) },
    { key: 'value', label: 'Might spend', width: 120, align: 'right', sortValue: (r) => r.value, render: (r) => (r.value > 0 ? cellNum(inr(r.value, 0)) : cellText('—')) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Leads & pipeline"
          subtitle={`${leads.length} in all`}
          right={<DeskButton label="New lead" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/crm/leads/edit')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Open" value={inrShort(pipe.open.value)} delta={`${pipe.open.count} lead${pipe.open.count === 1 ? '' : 's'} · likely ${inrShort(pipe.weighted)}`} onPress={() => setFilter('open')} />
        <KpiTile label="Won" value={inrShort(pipe.won.value)} tone="success" delta={pipe.winRatePct === null ? 'None decided yet' : `${pipe.winRatePct}% of decided`} onPress={() => setFilter('won')} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 360, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput
            value={q} onChangeText={setQ} placeholder="Search name, phone, source" placeholderTextColor={c.inkMute}
            autoCorrect={false} autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Chip label="Open" selected={filter === 'open'} onPress={() => setFilter('open')} />
          <Chip label={`Follow up${dueCount ? ` (${dueCount})` : ''}`} selected={filter === 'due'} onPress={() => setFilter('due')} />
          {STAGES.map((s) => <Chip key={s.id} label={`${s.label} (${pipe.byStage[s.id].count})`} selected={filter === s.id} onPress={() => setFilter(s.id)} />)}
        </View>
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/crm/leads/[id]', params: { id: r.id } })}
          emptyLabel={q || filter !== 'open' ? 'No leads match' : 'No open leads'}
        />
      </View>
    </DeskPage>
  )
}

// ───────────────────────────── leads/[id].tsx ─────────────────────────────

export interface DesktopLeadViewProps {
  lead: Lead
  shop: string
  open: boolean
  f: 'none' | 'overdue' | 'today' | 'later'
}

/**
 * The desktop lead-detail screen: a toolbar with the Edit action, a profile-and-pipeline-actions panel, and a side
 * panel for tasks and the contact log — the phone screen has no table of line items to grid, so this keeps the
 * `Toolbar` + side-panel shell (`SplitPane`) without forcing `DataTable` where there is no tabular data. Every value
 * and handler (`convertLead`, `moveLead`, `setFollowUp`, `deleteLead`) is the same the phone `leads/[id].tsx` calls.
 */
export function DesktopLeadView({ lead, shop, open, f }: DesktopLeadViewProps) {
  const { c } = useTheme()
  const router = useRouter()
  const [losing, setLosing] = useState(false)
  const [reason, setReason] = useState('')
  const [follow, setFollow] = useState('')
  const [dating, setDating] = useState(false)

  const move = (stage: Parameters<typeof moveLead>[2], why = '') => {
    try { perform((s, ctx) => moveLead(s, lead.id, stage, ctx, why)); setLosing(false); setReason('') } catch (e) { failWith(e) }
  }
  function convert() {
    try {
      const r = perform((s, ctx) => convertLead(s, lead.id, ctx))
      toast(r.existed ? `${r.customer.name} was already a customer — linked` : `${r.customer.name} is now a customer`, 'ok')
      router.replace({ pathname: '/customers/[id]', params: { id: r.customer.id } })
    } catch (e) { failWith(e) }
  }
  function saveDate(clear = false) {
    try { perform((s, ctx) => setFollowUp(s, lead.id, clear ? null : dateValue(follow) ?? null, ctx)); setDating(false) } catch (e) { failWith(e) }
  }
  async function remove() {
    if (!(await ask({ title: 'Delete this lead?', message: 'Its notes stay in the log.', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteLead(s, lead.id, ctx)); router.back() } catch (e) { failWith(e) }
  }

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={lead.name}
          subtitle={lead.no}
          right={open ? <DeskButton label="Edit" onPress={() => router.push({ pathname: '/m/crm/leads/edit', params: { id: lead.id } })} /> : undefined}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Stage" value={STAGE_LABEL[lead.stage]} tone={STAGE_TONE[lead.stage]} delta={lead.source || '—'} />
        {lead.value > 0 ? <KpiTile label="Might spend" value={inr(lead.value, 0)} /> : null}
        {lead.nextFollowUp !== undefined && open ? <KpiTile label="Follow up" value={fmtDate(lead.nextFollowUp)} tone={f === 'overdue' ? 'danger' : f === 'today' ? 'warning' : 'default'} /> : null}
      </KpiStrip>

      {f === 'overdue' || f === 'today' ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <Notice tone={f === 'overdue' ? 'danger' : 'warning'} title={f === 'overdue' ? 'Follow-up is late' : 'Follow up today'} body="Call or message them, then set the next date." action="Set date" onAction={() => { setFollow(dateText(lead.nextFollowUp)); setDating(true) }} />
        </View>
      ) : null}

      <View style={{ flex: 1, flexDirection: 'row' }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            {lead.phone ? <KV k="Mobile" v={lead.phone} /> : null}
            {lead.email ? <KV k="Email" v={lead.email} /> : null}
            <KV k="Added" v={fmtDate(lead.createdAt)} />
            {lead.lostReason ? <View style={{ marginTop: 6, gap: 2 }}><T style={[dtext.label, { color: c.inkMute }]}>Lost because</T><T style={dtext.cell}>{lead.lostReason}</T></View> : null}
            {lead.notes ? <View style={{ marginTop: 6, gap: 2 }}><T style={[dtext.label, { color: c.inkMute }]}>Notes</T><T style={dtext.cell}>{lead.notes}</T></View> : null}
            {lead.phone ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                <Button label="Call" kind="soft" size="sm" icon={<Phone size={15} color={c.primary} />} onPress={() => void Linking.openURL(`tel:${lead.phone}`)} />
                <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(`Hello ${lead.name.split(' ')[0]}, this is ${shop}. Thank you for your interest.`, lead.phone)} />
              </View>
            ) : null}
          </View>

          {lead.customerId ? (
            <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: lead.customerId as string } })} />
          ) : null}

          {open ? (
            <Section title="Move along" style={{ marginTop: 0 }}>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {stagesFrom(lead).filter((s) => s !== 'lost').map((s) => <Chip key={s} label={STAGE_LABEL[s]} onPress={() => move(s)} />)}
                <Chip label="Follow-up date" onPress={() => { setFollow(dateText(lead.nextFollowUp)); setDating(true) }} />
                <Chip label="Lost" tone="danger" onPress={() => setLosing(true)} />
              </View>
              <Button label="Make a customer (won)" size="lg" block icon={<Check size={18} color={c.onPrimary} />} onPress={convert} style={{ marginTop: 12 }} />
            </Section>
          ) : lead.stage === 'lost' ? (
            <Button label="Reopen this lead" kind="soft" block onPress={() => move('new')} />
          ) : null}

          <Button label="Delete lead" kind="ghost" icon={<Trash size={16} color={c.danger} />} onPress={() => void remove()} />
        </ScrollView>

        <View style={{ width: 360, borderLeftWidth: 1, borderLeftColor: c.line, backgroundColor: c.bg }}>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 14 }}>
            <TasksSection target={{ leadId: lead.id }} />
            <NotesSection target={{ leadId: lead.id }} />
          </ScrollView>
        </View>
      </View>

      <Sheet visible={losing} onClose={() => setLosing(false)} title="Why was it lost?" footer={<Button label="Mark as lost" kind="danger" size="lg" block onPress={() => move('lost', reason)} />}>
        <Field value={reason} onChangeText={setReason} autoCapitalize="sentences" placeholder="Too expensive, bought elsewhere…" />
      </Sheet>
      <Sheet visible={dating} onClose={() => setDating(false)} title="Follow up on" footer={<Button label="Save date" size="lg" block onPress={() => saveDate()} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <DateField label="Date" value={follow} onChange={setFollow} />
          <Button label="Clear the date" kind="ghost" size="sm" onPress={() => saveDate(true)} />
        </View>
      </Sheet>
    </DeskPage>
  )
}

// ───────────────────────────── leads/edit.tsx ─────────────────────────────

export interface DesktopLeadEditProps {
  existing?: Lead
  name: string; setName: (v: string) => void
  phone: string; setPhone: (v: string) => void
  email: string; setEmail: (v: string) => void
  source: string; setSource: (v: string) => void
  value: string; setValue: (v: string) => void
  follow: string; setFollow: (v: string) => void
  notes: string; setNotes: (v: string) => void
  assignee: string; setAssignee: (v: string) => void
  users: Array<{ id: string; name: string }>
  onSave: () => void
}

/** The desktop add/edit-lead form: the same centred-column shell every desktop form uses, around the exact same fields. */
export function DesktopLeadEdit(p: DesktopLeadEditProps) {
  return (
    <DesktopSettingsPage title={p.existing ? 'Edit lead' : 'New lead'} right={<DeskButton label="Save lead" tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <Field label="Name" value={p.name} onChangeText={p.setName} autoCapitalize="words" />
        <Field label="Mobile number" value={p.phone} onChangeText={(t) => p.setPhone(t.replace(/[^\d+ ]/g, ''))} keyboardType="phone-pad" placeholder="10 digits" />
        <Field label="Email (optional)" value={p.email} onChangeText={p.setEmail} autoCapitalize="none" keyboardType="email-address" />
        <View style={{ gap: 8 }}>
          <Field label="Where did they come from?" value={p.source} onChangeText={p.setSource} autoCapitalize="sentences" />
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{SOURCES.map((x) => <Chip key={x} label={x} selected={p.source === x} onPress={() => p.setSource(x)} />)}</View>
        </View>
        <MoneyField label="What might they spend? (optional)" value={p.value} onChange={p.setValue} />
        <DateField label="Follow up on" value={p.follow} onChange={p.setFollow} hint="You will be reminded on this day." />
        {p.users.length > 1 ? <Select label="Looked after by" value={p.assignee} placeholder="Anyone" options={[{ value: '', label: 'Anyone' }, ...p.users.map((u) => ({ value: u.id, label: u.name }))]} onChange={p.setAssignee} /> : null}
        <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline autoCapitalize="sentences" />
      </View>
    </DesktopSettingsPage>
  )
}
