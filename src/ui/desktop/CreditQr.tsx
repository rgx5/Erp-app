import React, { useMemo, useState } from 'react'
import { Linking, Share, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { inr, round2 } from '@/domain/money'
import { useList } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { paymentRequest } from '@/modules/credit/reminders'
import { QrCode as QrView } from '@/modules/credit/ui/QrCode'
import { Field, MoneyField } from '@/ui/Inputs'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { MessageCircle, Share as ShareIcon } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, dtext, Toolbar } from './kit'
import { Notice } from '@/ui/blocks'

/**
 * The desktop UPI QR screen: the same amount/note fields and QR code, centred in a card, instead of the phone's
 * stacked layout. Reads its own data directly, exactly like `DesktopPurchases`: the request itself comes from the
 * same `paymentRequest` the phone `m/credit/qr.tsx` calls.
 */
export function DesktopUpiQr() {
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

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="UPI QR & link" />}>
        <View style={{ padding: 20 }}><T tone="mute">The QR is for people who can take sales.</T></View>
      </DeskPage>
    )
  }
  const hasUpi = !!data.creditSettings?.credit?.upiId

  return (
    <DeskPage toolbar={<Toolbar title="UPI QR & link" />}>
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 32 }}>
        <View style={{ width: '100%', maxWidth: 420, gap: 14 }}>
          {!hasUpi ? <Notice tone="warning" title="Add your UPI id first" body="The QR needs the id the money should go to." action="Settings" onAction={() => router.push('/m/credit/settings')} /> : null}
          <MoneyField label="Amount" value={amount} onChange={setAmount} placeholder="0" large />
          <Field label="For" value={note} onChangeText={setNote} placeholder="Bill number or what it is for" />
          {req.upi ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 20, alignItems: 'center', gap: 10 }}>
              <QrView value={req.upi} size={220} />
              <T style={dtext.title}>{inr(amt, 0)}</T>
              <T style={[dtext.tiny, { color: c.inkMute, textAlign: 'center' }]}>Scan with any UPI app. Pays {data.creditSettings?.credit?.payeeName || data.store?.name}.</T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                {req.whatsapp ? <DeskButton label="WhatsApp" icon={<MessageCircle size={13} color={c.ink} />} onPress={() => Linking.openURL(req.whatsapp!).catch(() => toast('Could not open WhatsApp', 'err'))} /> : null}
                <DeskButton label="Share link" icon={<ShareIcon size={13} color={c.ink} />} onPress={() => void Share.share({ message: req.text })} />
              </View>
            </View>
          ) : hasUpi ? <T tone="mute">Enter an amount to show the QR.</T> : null}
          <T style={[dtext.tiny, { color: c.inkMute }]}>This is a UPI payment link, not an online-gateway checkout. The phone cannot tell whether the customer paid — look for the credit in your UPI app or SMS, then record the payment. Automatic confirmation needs a payment gateway on the server.</T>
        </View>
      </View>
    </DeskPage>
  )
}
