import React, { useMemo, useState } from 'react'
import { Linking, Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { reminderQueue, type ReminderTone } from '@/modules/credit/reminders'
import { Button } from '@/ui/Button'
import { Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card } from '@/ui/primitives'
import { EmptyState, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Bell, MessageCircle, Send, Share as ShareIcon } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Customers who are past their due date, each with a ready message to send on WhatsApp or SMS. */
export default function Reminders() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('collections')
  const data = useApp((s) => s.data)
  const [tone, setTone] = useState<ReminderTone>(data.creditSettings?.credit?.reminderTone ?? 'polite')
  const now = Date.now()
  const queue = useMemo(() => reminderQueue(data, now, { tone }), [data, now, tone])

  if (!can) return <Screen title="Payment reminders" back><T tone="mute">Reminders are for the owner, managers and cashiers.</T></Screen>
  const open = (url: string | null) => { if (url) Linking.openURL(url).catch(() => toast('Could not open the app', 'err')); else toast('This customer has no usable phone number', 'err') }

  return (
    <Screen title="Payment reminders" subtitle={queue.length ? `${queue.length} overdue` : undefined} back>
      <View style={{ gap: 12, paddingBottom: 24 }}>
        <Segmented value={tone} options={[{ value: 'polite', label: 'Polite' }, { value: 'firm', label: 'Firm' }]} onChange={setTone} />
        {!data.creditSettings?.credit?.upiId ? <Notice tone="primary" title="Add your UPI id to include a pay link" body="Messages then carry a link that opens the customer's UPI app with the amount filled in." action="Settings" onAction={() => router.push('/m/credit/settings')} /> : null}
        {!queue.length ? <EmptyState icon={<Bell size={26} color={c.primary} />} title="No one is overdue" hint="When a customer's due date passes, they appear here with a message ready to send." /> : null}
        {queue.map((r) => (
          <Card key={r.customerId}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Avatar name={r.name} size={40} />
              <View style={{ flex: 1 }}>
                <T v="bodyStrong" numberOfLines={1}>{r.name}</T>
                <T v="caption" tone="mute">{r.phone || 'No phone number'}</T>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <T v="num">{inr(r.overdue, 0)}</T>
                <Badge tone="danger">{r.oldestDaysOverdue} days late</Badge>
              </View>
            </View>
            <T v="caption" tone="soft" style={{ marginTop: 10 }}>{r.text}</T>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color={c.onPrimary} />} onPress={() => open(r.whatsapp)} />
              <Button label="SMS" kind="soft" size="sm" icon={<Send size={15} color={c.primary} />} onPress={() => open(r.sms)} />
              <Button label="Share" kind="soft" size="sm" icon={<ShareIcon size={15} color={c.primary} />} onPress={() => void Share.share({ message: r.text })} />
              <Button label="Account" kind="ghost" size="sm" onPress={() => router.push({ pathname: '/m/credit/customer/[id]', params: { id: r.customerId } })} />
            </View>
          </Card>
        ))}
        {queue.length ? <T v="caption" tone="mute">The message opens in WhatsApp or the messages app for you to press send. Sending by itself needs the WhatsApp Business service or an SMS provider, which is set up on the server.</T> : null}
      </View>
    </Screen>
  )
}
