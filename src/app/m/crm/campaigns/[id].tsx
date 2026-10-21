import React, { useMemo, useState } from 'react'
import { Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { perform, useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Group, ProgressBar, Tap } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, MessageCircle, Send, Trash, Undo } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { campaignProgress, linkFor, nextPending, sendsOf } from '@/modules/crm/campaigns'
import { deleteCampaign, markSend } from '@/modules/crm/ops'
import type { CampaignSend, SendStatus } from '@/modules/crm/types'
import { failWith } from '@/modules/crm/ui/forms'

/** A campaign's list of messages. Open the next one, press send in WhatsApp, come back and confirm. */
export default function CampaignView() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('crm')
  const data = useApp((s) => s.data)
  const camp = data.crmCampaigns?.[id]
  const [awaiting, setAwaiting] = useState<string | null>(null)
  const sends = useMemo(() => sendsOf(data, id), [data, id])
  const prog = campaignProgress(sends)

  if (!can) return <Screen title="Campaign" back><T tone="mute">Campaigns are for the owner and managers.</T></Screen>
  if (!camp) return <Screen title="Not found" back><T tone="mute">This campaign is no longer here.</T></Screen>
  const current = sends.find((s) => s.id === awaiting && s.status === 'pending') ?? null

  async function open(s: CampaignSend) {
    const url = linkFor(camp!.channel, s.phone, s.text)
    if (!url) { toast('This customer has no usable phone number', 'err'); return }
    try { await Linking.openURL(url); setAwaiting(s.id) } catch { toast('Could not open the app', 'err') }
  }
  function mark(s: CampaignSend, status: SendStatus) {
    try {
      perform((st, ctx) => markSend(st, s.id, status, ctx))
      setAwaiting(null)
    } catch (e) { failWith(e) }
  }
  async function remove() {
    if (!(await ask({ title: 'Delete this campaign?', message: 'The list and its sent record are removed. Notes already logged on customers stay.', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteCampaign(s, id, ctx)); router.back() } catch (e) { failWith(e) }
  }
  const next = nextPending(sends)

  return (
    <Screen title={camp.name} subtitle={`${camp.no} · ${camp.audienceName} · ${camp.channel === 'sms' ? 'SMS' : 'WhatsApp'}`} back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <T v="bodyStrong">{prog.sent} sent · {prog.skipped} skipped</T>
            <T tone="mute">{prog.pending} left</T>
          </View>
          <ProgressBar value={prog.pct / 100} tone={prog.done ? 'success' : 'primary'} />
          <T v="caption" tone="mute" style={{ marginTop: 10 }}>{camp.template}</T>
        </Card>

        {current ? (
          <Card tone="warning">
            <T v="bodyStrong">Did you send it to {current.name}?</T>
            <T v="caption" tone="mute" style={{ marginTop: 2 }}>The app cannot see whether you pressed send, so tell it here.</T>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Button label="Yes, sent" kind="success" size="sm" icon={<Check size={15} color="#fff" />} onPress={() => { mark(current, 'sent'); const n = sends.find((x) => x.status === 'pending' && x.id !== current.id); if (n) void open(n) }} />
              <Button label="Sent — stop" kind="soft" size="sm" onPress={() => mark(current, 'sent')} />
              <Button label="Skip" kind="ghost" size="sm" onPress={() => mark(current, 'skipped')} />
            </View>
          </Card>
        ) : next ? (
          <Button label={`Open next: ${next.name}`} size="lg" block icon={<Send size={18} color={c.onPrimary} />} onPress={() => void open(next)} />
        ) : (
          <Card tone="success"><T v="bodyStrong">All done</T><T v="caption" tone="mute">Every message has been sent or skipped. Each sent one is in that customer&apos;s contact log.</T></Card>
        )}

        <Section title="Messages" style={{ marginTop: 0 }}>
          <Group>
            {sends.map((s) => (
              <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 }}>
                <Avatar name={s.name} size={36} />
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong" numberOfLines={1}>{s.name}</T>
                  <T v="caption" tone="mute" numberOfLines={2}>{s.text}</T>
                </View>
                {s.status === 'pending' ? (
                  <Tap onPress={() => void open(s)} hitSlop={8} accessibilityLabel={`Open ${s.name}`}><MessageCircle size={22} color={c.success} /></Tap>
                ) : (
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    <Badge tone={s.status === 'sent' ? 'success' : 'default'}>{s.status === 'sent' ? 'Sent' : 'Skipped'}</Badge>
                    <Tap onPress={() => mark(s, 'pending')} hitSlop={8} accessibilityLabel="Undo"><Undo size={16} color={c.inkMute} /></Tap>
                  </View>
                )}
              </View>
            ))}
          </Group>
        </Section>
        <Button label="Delete campaign" kind="ghost" icon={<Trash size={16} color={c.danger} />} onPress={() => void remove()} />
      </View>
    </Screen>
  )
}
