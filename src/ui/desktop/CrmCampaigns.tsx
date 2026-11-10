import React from 'react'
import { Linking, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { perform, useApp, useCan } from '@/data/store'
import { campaignProgress, linkFor, MERGE_FIELDS, nextPending, sendsOf, TEMPLATES, unknownFields } from '@/modules/crm/campaigns'
import { deleteCampaign, markSend } from '@/modules/crm/ops'
import type { Campaign, CampaignSend, Channel, SendStatus } from '@/modules/crm/types'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Chip } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ask, toast } from '@/ui/overlays'
import { Check, MessageCircle, Plus, Send, Trash, Undo } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { cellText, DataTable, DeskButton, DeskPage, dtext, Pill, Toolbar, type Column } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

type Row = { id: string; name: string; no: string; audience: string; date: number; sent: number; total: number; pending: number; done: boolean }

/**
 * The desktop Campaigns screen: one dense sortable grid of every campaign (name, audience, progress) instead of
 * scrolling `ListRow`s. Reads its own data directly, exactly like `DesktopPurchases`: every count comes from the
 * same `campaignProgress`/`sendsOf` the phone `m/crm/campaigns/index.tsx` calls.
 */
export function DesktopCampaigns() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('crm')
  const list = useList('crmCampaigns')
  const data = useApp((s) => s.data)

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Campaigns" />}>
        <View style={{ padding: 20 }}><T tone="mute">Campaigns are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const rows: Row[] = [...list].sort((a, b) => b.createdAt - a.createdAt).map((x) => {
    const p = campaignProgress(sendsOf(data, x.id))
    return { id: x.id, name: x.name, no: x.no, audience: x.audienceName, date: x.createdAt, sent: p.sent, total: p.total, pending: p.pending, done: !!x.closedAt }
  })

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Campaign', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.no} · {r.audience} · {fmtDayShort(r.date)}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 110, sortValue: (r) => (r.done ? 1 : 0), render: (r) => (r.done ? <Pill tone="success" label="Done" /> : <Pill tone="warning" label={`${r.pending} left`} />) },
    { key: 'progress', label: 'Sent', width: 100, align: 'right', sortValue: (r) => r.sent, render: (r) => cellText(`${r.sent}/${r.total}`) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Campaigns"
          right={<DeskButton label="New campaign" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/crm/campaigns/new')} />}
        />
      }
    >
      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/crm/campaigns/[id]', params: { id: r.id } })} emptyLabel="No campaigns yet" />
      </View>
      <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
        <T style={[dtext.tiny, { color: c.inkMute }]}>Each message opens in WhatsApp or your messages app with the text ready; you press send. Sending to many people automatically needs the WhatsApp Business service or an SMS provider, set up on a server.</T>
      </View>
    </DeskPage>
  )
}

// ───────────────────────────── campaigns/[id].tsx ─────────────────────────────

export interface DesktopCampaignViewProps { camp: Campaign; sends: CampaignSend[] }

/** The desktop campaign-detail screen: the progress bar and next-message action up top, then every message as a dense grid. */
export function DesktopCampaignView({ camp, sends }: DesktopCampaignViewProps) {
  const { c } = useTheme()
  const router = useRouter()
  const [awaiting, setAwaiting] = React.useState<string | null>(null)
  const prog = campaignProgress(sends)
  const next = nextPending(sends)
  const current = sends.find((s) => s.id === awaiting && s.status === 'pending') ?? null

  async function open(s: CampaignSend) {
    const url = linkFor(camp.channel, s.phone, s.text)
    if (!url) { toast('This customer has no usable phone number', 'err'); return }
    try { await Linking.openURL(url); setAwaiting(s.id) } catch { toast('Could not open the app', 'err') }
  }
  function mark(s: CampaignSend, status: SendStatus) {
    try { perform((st, ctx) => markSend(st, s.id, status, ctx)); setAwaiting(null) } catch (e) { toast(e instanceof Error ? e.message : 'Could not save', 'err') }
  }
  async function remove() {
    if (!(await ask({ title: 'Delete this campaign?', message: 'The list and its sent record are removed. Notes already logged on customers stay.', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteCampaign(s, camp.id, ctx)); router.back() } catch (e) { toast(e instanceof Error ? e.message : 'Could not delete', 'err') }
  }

  const columns: Array<Column<CampaignSend>> = [
    { key: 'name', label: 'Customer', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={2}>{r.text}</T>
      </View>
    ) },
    { key: 'status', label: '', width: 140, sortValue: (r) => r.status, render: (r) => (
      r.status === 'pending'
        ? <DeskButton label="Open" icon={<MessageCircle size={13} color={c.ink} />} onPress={() => void open(r)} />
        : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Pill tone={r.status === 'sent' ? 'success' : 'default'} label={r.status === 'sent' ? 'Sent' : 'Skipped'} />
          <Pressable onPress={() => mark(r, 'pending')} hitSlop={8}><Undo size={14} color={c.inkMute} /></Pressable></View>
    ) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title={camp.name} subtitle={`${camp.no} · ${camp.audienceName} · ${camp.channel === 'sms' ? 'SMS' : 'WhatsApp'}`} right={<DeskButton label="Delete campaign" tone="danger" icon={<Trash size={14} color={c.danger} />} onPress={() => void remove()} />} />}>
      <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 10 }}>
        <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <T style={dtext.cellStrong}>{prog.sent} sent · {prog.skipped} skipped</T>
            <T style={[dtext.cell, { color: c.inkMute }]}>{prog.pending} left</T>
          </View>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: c.sunken, overflow: 'hidden' }}>
            <View style={{ width: `${prog.pct}%`, height: 8, backgroundColor: prog.done ? c.success : c.primary }} />
          </View>
          <T style={[dtext.tiny, { color: c.inkMute, marginTop: 10 }]}>{camp.template}</T>
        </View>

        {current ? (
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.warning, borderRadius: 8, padding: 14, gap: 8 }}>
            <T style={dtext.cellStrong}>Did you send it to {current.name}?</T>
            <T style={[dtext.tiny, { color: c.inkMute }]}>The app cannot see whether you pressed send, so tell it here.</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <DeskButton label="Yes, sent" tone="primary" icon={<Check size={13} color={c.onPrimary} />} onPress={() => { mark(current, 'sent'); const n = sends.find((x) => x.status === 'pending' && x.id !== current.id); if (n) void open(n) }} />
              <DeskButton label="Sent — stop" onPress={() => mark(current, 'sent')} />
              <DeskButton label="Skip" onPress={() => mark(current, 'skipped')} />
            </View>
          </View>
        ) : next ? (
          <DeskButton label={`Open next: ${next.name}`} tone="primary" icon={<Send size={14} color={c.onPrimary} />} onPress={() => void open(next)} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Check size={16} color={c.success} /><T style={dtext.cellStrong}>All done — every message sent or skipped.</T></View>
        )}
      </View>

      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={sends} columns={columns} emptyLabel="No messages" />
      </View>
    </DeskPage>
  )
}

// ───────────────────────────── campaigns/new.tsx ─────────────────────────────

export interface DesktopCampaignNewProps {
  name: string; setName: (v: string) => void
  channel: Channel; setChannel: (v: Channel) => void
  audience: string; setAudience: (v: string) => void
  template: string; setTemplate: (v: string) => void
  audienceOptions: Array<{ value: string; label: string; sub?: string }>
  preview: { n: number; noPhone: number; optedOut: number; sample: string } | null
  onSave: () => void
}

/** The desktop new-campaign form: the same centred-column shell, the template chips and merge fields, and the live preview. */
export function DesktopCampaignNew(p: DesktopCampaignNewProps) {
  const { c } = useTheme()
  const bad = unknownFields(p.template)
  return (
    <DesktopSettingsPage title="New campaign" right={<DeskButton label={p.preview ? `Build ${p.preview.n} messages` : 'Build messages'} tone="primary" onPress={p.onSave} />}>
      <View style={{ gap: 14 }}>
        <Field label="Campaign name" value={p.name} onChangeText={p.setName} autoCapitalize="sentences" placeholder="Diwali greetings" />
        <Select label="Send to" value={p.audience} options={p.audienceOptions} onChange={p.setAudience} searchable />
        <Segmented value={p.channel} onChange={p.setChannel} options={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'sms', label: 'SMS' }]} />
        <View style={{ gap: 8 }}>
          <T style={[dtext.label, { color: c.inkMute }]}>Message</T>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {TEMPLATES.map((t) => <Chip key={t.id} label={t.label} onPress={() => { p.setTemplate(t.text); p.setChannel(t.channel); if (!p.name) p.setName(t.label) }} />)}
          </View>
          <Field value={p.template} onChangeText={p.setTemplate} multiline autoCapitalize="sentences" placeholder="Write your message, or pick one above" error={bad.length ? `{{${bad[0]}}} is not a known field` : null} />
          <T v="caption" tone="mute">Tap to add a field that fills in for each customer:</T>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {MERGE_FIELDS.map((f) => <Chip key={f.key} label={f.label} onPress={() => p.setTemplate(`${p.template}${p.template && !p.template.endsWith(' ') ? ' ' : ''}{{${f.key}}}`)} />)}
          </View>
        </View>
        {p.preview ? (
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute }]}>Preview for the first customer</T>
            <T style={[dtext.cell, { marginTop: 6 }]}>{p.preview.sample || 'No customer can be messaged in this segment.'}</T>
            <T style={[dtext.tiny, { color: c.inkMute, marginTop: 8 }]}>{p.preview.n} will get it{p.preview.noPhone ? ` · ${p.preview.noPhone} skipped (no valid number)` : ''}{p.preview.optedOut ? ` · ${p.preview.optedOut} skipped (opted out)` : ''}</T>
          </View>
        ) : null}
        {p.channel === 'whatsapp' ? <Notice tone="primary" title="Promotional WhatsApp messages" body="Message only customers who are happy to hear from you. Mark anyone who asks to stop as “no promotions” on their page and they are left out." /> : null}
      </View>
    </DesktopSettingsPage>
  )
}
