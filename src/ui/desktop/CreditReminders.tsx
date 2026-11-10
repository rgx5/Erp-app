import React, { useMemo, useState } from 'react'
import { Linking, ScrollView, Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { reminderQueue, type ReminderTone } from '@/modules/credit/reminders'
import { Button } from '@/ui/Button'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { Bell, MessageCircle, Send, Share as ShareIcon } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskPage, DeskSegmented, dtext, Pill, Toolbar } from './kit'
import { Notice } from '@/ui/blocks'

/**
 * The desktop Payment reminders screen: the same polite/firm toggle and one card per overdue customer, laid out as
 * a wrapping grid instead of a scrolling list. Reads its own data directly, exactly like `DesktopPurchases`: every
 * message and amount comes from the same `reminderQueue` the phone `m/credit/reminders.tsx` calls.
 */
export function DesktopReminders() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('collections')
  const data = useApp((s) => s.data)
  const [tone, setTone] = useState<ReminderTone>(data.creditSettings?.credit?.reminderTone ?? 'polite')
  const now = Date.now()
  const queue = useMemo(() => reminderQueue(data, now, { tone }), [data, now, tone])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Payment reminders" />}>
        <View style={{ padding: 20 }}><T tone="mute">Reminders are for the owner, managers and cashiers.</T></View>
      </DeskPage>
    )
  }
  const open = (url: string | null) => { if (url) Linking.openURL(url).catch(() => toast('Could not open the app', 'err')); else toast('This customer has no usable phone number', 'err') }

  return (
    <DeskPage
      toolbar={
        <Toolbar title="Payment reminders" subtitle={queue.length ? `${queue.length} overdue` : undefined} right={<DeskSegmented value={tone} onChange={setTone} options={[{ id: 'polite', label: 'Polite' }, { id: 'firm', label: 'Firm' }]} />} />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
        {!data.creditSettings?.credit?.upiId ? <Notice tone="primary" title="Add your UPI id to include a pay link" body="Messages then carry a link that opens the customer's UPI app with the amount filled in." action="Settings" onAction={() => router.push('/m/credit/settings')} /> : null}
        {!queue.length ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 8 }}>
            <Bell size={26} color={c.primary} />
            <T style={dtext.cellStrong}>No one is overdue</T>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {queue.map((r) => (
            <View key={r.customerId} style={{ minWidth: 300, maxWidth: 380, flexGrow: 1, flexBasis: 300, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, gap: 1 }}>
                  <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
                  <T style={[dtext.tiny, { color: c.inkMute }]}>{r.phone || 'No phone number'}</T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <T style={dtext.numStrong}>{inr(r.overdue, 0)}</T>
                  <Pill tone="danger" label={`${r.oldestDaysOverdue} days late`} />
                </View>
              </View>
              <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={3}>{r.text}</T>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={14} color="#fff" />} onPress={() => open(r.whatsapp)} />
                <Button label="SMS" kind="soft" size="sm" icon={<Send size={14} color={c.primary} />} onPress={() => open(r.sms)} />
                <Button label="Share" kind="soft" size="sm" icon={<ShareIcon size={14} color={c.primary} />} onPress={() => void Share.share({ message: r.text })} />
                <Button label="Account" kind="ghost" size="sm" onPress={() => router.push({ pathname: '/m/credit/customer/[id]', params: { id: r.customerId } })} />
              </View>
            </View>
          ))}
        </View>
        {queue.length ? <T style={[dtext.tiny, { color: c.inkMute }]}>The message opens in WhatsApp or the messages app for you to press send. Sending by itself needs the WhatsApp Business service or an SMS provider, which is set up on the server.</T> : null}
      </ScrollView>
    </DeskPage>
  )
}
