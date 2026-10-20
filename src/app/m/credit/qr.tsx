import React, { useMemo, useState } from 'react'
import { Linking, Share, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { inr, round2 } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { paymentRequest } from '@/modules/credit/reminders'
import { QrCode as QrView } from '@/modules/credit/ui/QrCode'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { MessageCircle, Share as ShareIcon } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/**
 * A UPI QR code for an exact amount, and the same payment as a link to send. It is the standard UPI deep link, so any UPI app pays it.
 * The app cannot see whether the payer completed it — check the UPI app / SMS for the credit, then record the payment.
 */
export default function UpiQr() {
  const { c } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ amount?: string; note?: string; ref?: string; customerId?: string }>()
  const can = useCan('pos')
  const data = useApp((s) => s.data)
  const customers = useList('customers')
  const [amount, setAmount] = useState(params.amount && Number(params.amount) > 0 ? params.amount : '')
  const [note, setNote] = useState(params.note ?? '')
  const customer = customers.find((x) => x.id === params.customerId)

  const amt = round2(Number(amount) || 0)
  const req = useMemo(() => paymentRequest(data, { amount: amt, note: note.trim() || 'your purchase', ...(params.ref ? { ref: params.ref } : {}), ...(customer ? { phone: customer.phone } : {}) }), [data, amt, note, params.ref, customer])

  if (!can) return <Screen title="UPI QR" back><T tone="mute">The QR is for people who can take sales.</T></Screen>
  const hasUpi = !!data.creditSettings?.credit?.upiId

  return (
    <Screen title="UPI QR & link" back>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        {!hasUpi ? <Notice tone="warning" title="Add your UPI id first" body="The QR needs the id the money should go to." action="Settings" onAction={() => router.push('/m/credit/settings')} /> : null}
        <MoneyField label="Amount" value={amount} onChange={setAmount} placeholder="0" large />
        <Field label="For" value={note} onChangeText={setNote} placeholder="Bill number or what it is for" />
        {req.upi ? (
          <Card>
            <View style={{ alignItems: 'center', gap: 10 }}>
              <QrView value={req.upi} size={240} />
              <T v="h2">{inr(amt, 0)}</T>
              <T v="caption" tone="mute" align="center">Scan with any UPI app. Pays {data.creditSettings?.credit?.payeeName || data.store?.name}.</T>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
              {req.whatsapp ? <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color={c.onPrimary} />} onPress={() => Linking.openURL(req.whatsapp!).catch(() => toast('Could not open WhatsApp', 'err'))} /> : null}
              <Button label="Share link" kind="soft" size="sm" icon={<ShareIcon size={15} color={c.primary} />} onPress={() => void Share.share({ message: req.text })} />
            </View>
          </Card>
        ) : hasUpi ? <T tone="mute">Enter an amount to show the QR.</T> : null}
        <T v="caption" tone="mute">This is a UPI payment link, not an online-gateway checkout. The phone cannot tell whether the customer paid — look for the credit in your UPI app or SMS, then record the payment. Automatic confirmation needs a payment gateway on the server.</T>
      </View>
    </Screen>
  )
}
