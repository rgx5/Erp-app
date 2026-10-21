import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { perform, useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { Button } from '@/ui/Button'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { buildAudience, MERGE_FIELDS, TEMPLATES, unknownFields } from '@/modules/crm/campaigns'
import { createCampaign } from '@/modules/crm/ops'
import { PRESET_SEGMENTS } from '@/modules/crm/segments'
import type { Channel } from '@/modules/crm/types'
import { failWith } from '@/modules/crm/ui/forms'

/** Build a campaign: who, which channel, what to say. Nothing is sent until you open the messages one by one. */
export default function CampaignNew() {
  const router = useRouter()
  const params = useLocalSearchParams<{ audience?: string }>()
  const can = useCan('crm')
  const data = useApp((s) => s.data)
  const [name, setName] = useState('')
  const [channel, setChannel] = useState<Channel>('whatsapp')
  const [audience, setAudience] = useState(params.audience ?? 'preset:lapsed')
  const [template, setTemplate] = useState('')
  const options = useMemo(() => [
    { value: 'all', label: 'All customers' },
    ...listOf(data.crmSegments ?? {}).map((s) => ({ value: s.id, label: s.name, sub: 'Your segment' })),
    ...PRESET_SEGMENTS.map((p) => ({ value: p.id, label: p.name, sub: p.note })),
  ], [data.crmSegments])
  const preview = useMemo(() => {
    if (!template.trim()) return null
    const a = buildAudience(data, audience, template, channel, Date.now())
    return a ? { n: a.recipients.length, noPhone: a.noPhone.length, optedOut: a.optedOut.length, sample: a.recipients[0]?.text ?? '' } : null
  }, [data, audience, template, channel])

  if (!can) return <Screen title="New campaign" back><T tone="mute">Campaigns are for the owner and managers.</T></Screen>
  const bad = unknownFields(template)
  function save() {
    try {
      const r = perform((s, ctx) => createCampaign(s, { name, channel, template, audience }, ctx))
      toast(`${r.sends.length} messages ready`, 'ok')
      router.replace({ pathname: '/m/crm/campaigns/[id]', params: { id: r.campaign.id } })
    } catch (e) { failWith(e) }
  }
  return (
    <Screen title="New campaign" back footer={<Button label={preview ? `Build ${preview.n} messages` : 'Build messages'} size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Field label="Campaign name" value={name} onChangeText={setName} autoCapitalize="sentences" placeholder="Diwali greetings" />
        <Select label="Send to" value={audience} options={options} onChange={setAudience} searchable />
        <Segmented value={channel} onChange={setChannel} options={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'sms', label: 'SMS' }]} />
        <Section title="Message" style={{ marginTop: 0 }}>
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {TEMPLATES.map((t) => <Chip key={t.id} label={t.label} onPress={() => { setTemplate(t.text); setChannel(t.channel); if (!name) setName(t.label) }} />)}
            </View>
            <Field value={template} onChangeText={setTemplate} multiline autoCapitalize="sentences" placeholder="Write your message, or pick one above" error={bad.length ? `{{${bad[0]}}} is not a known field` : null} />
            <T v="caption" tone="mute">Tap to add a field that fills in for each customer:</T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {MERGE_FIELDS.map((f) => <Chip key={f.key} label={f.label} onPress={() => setTemplate((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}{{${f.key}}}`)} />)}
            </View>
          </View>
        </Section>
        {preview ? (
          <Card>
            <T v="label" tone="soft">Preview for the first customer</T>
            <T style={{ marginTop: 6 }}>{preview.sample || 'No customer can be messaged in this segment.'}</T>
            <T v="caption" tone="mute" style={{ marginTop: 8 }}>{preview.n} will get it{preview.noPhone ? ` · ${preview.noPhone} skipped (no valid number)` : ''}{preview.optedOut ? ` · ${preview.optedOut} skipped (opted out)` : ''}</T>
          </Card>
        ) : null}
        {channel === 'whatsapp' ? <Notice tone="primary" title="Promotional WhatsApp messages" body="Message only customers who are happy to hear from you. Mark anyone who asks to stop as “no promotions” on their page and they are left out." /> : null}
      </View>
    </Screen>
  )
}
