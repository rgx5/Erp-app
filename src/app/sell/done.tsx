import React, { useEffect, useRef } from 'react'
import { Animated, Easing, ScrollView, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { receiptHtml, receiptText, invoiceHtml, paymentSummary } from '@/domain/receipt'
import { inr } from '@/domain/money'
import { fmtDateTime } from '@/domain/dates'
import { useLabels, useStore } from '@/data/hooks'
import { useApp } from '@/data/store'
import { printHtml, sharePdf, whatsApp } from '@/features/share'
import { Button } from '@/ui/Button'
import { Card, Tap } from '@/ui/primitives'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, FileText, Printer, Share } from '@/ui/icons'
import { success } from '@/ui/feedback'
import { useTheme } from '@/ui/theme'
import { firstName } from '@/domain/people'

/** The sale is saved. Hand over the receipt (WhatsApp, PDF, print) and start the next one. */
export default function SaleDone() {
  const { id, change } = useLocalSearchParams<{ id: string; change?: string }>()
  const { c, radius } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const store = useStore()
  const labels = useLabels()
  const bill = useApp((s) => s.data.bills[id])
  const customer = useApp((s) => (bill?.customerId ? s.data.customers[bill.customerId] : null)) ?? null
  const seller = useApp((s) => (bill ? s.data.users[bill.soldBy ?? bill.cashierId] : null)) ?? null
  const pop = useRef(new Animated.Value(0)).current
  const rise = useRef(new Animated.Value(0)).current

  useEffect(() => {
    success()
    Animated.sequence([
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, speed: 12, bounciness: 14 }),
      Animated.timing(rise, { toValue: 1, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start()
  }, [pop, rise])

  if (!bill) return null
  const changeDue = Number(change) || 0
  const ctx = { bill, store, customer, seller }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <LinearGradient colors={c.isDark ? ['#0F2E24', c.bg] : ['#DDF5EA', c.bg]} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 360 }} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 36, paddingBottom: 24, gap: 18 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Animated.View style={{ transform: [{ scale: pop }], width: 84, height: 84, borderRadius: 42, backgroundColor: c.success, alignItems: 'center', justifyContent: 'center' }}>
            <Check size={44} color="#fff" strokeWidth={3} />
          </Animated.View>
          <Animated.View style={{ alignItems: 'center', gap: 2, opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
            <T v="label" tone="success">PAYMENT RECEIVED</T>
            <T v="display" style={{ fontSize: 42, lineHeight: 48 }}>{inr(bill.total, 0)}</T>
            <T tone="mute">{bill.no} · {fmtDateTime(bill.date)}</T>
          </Animated.View>
        </View>

        {changeDue > 0 ? (
          <View style={{ padding: 16, borderRadius: radius.lg, backgroundColor: c.warningTint, alignItems: 'center' }}>
            <T v="caption" tone="warning">Return change to customer</T>
            <T v="display" tone="warning" style={{ fontSize: 34 }}>{inr(changeDue)}</T>
          </View>
        ) : null}

        <Card>
          <KV k="Paid by" v={paymentSummary(bill) || '—'} />
          {customer ? <KV k={labels.customer} v={customer.name} /> : null}
          {bill.loyaltyEarned > 0 ? <KV k="Points earned" v={`+${bill.loyaltyEarned}`} tone="success" /> : null}
          {bill.items.length ? <KV k="Items" v={String(bill.items.length)} /> : null}
        </Card>

        <View style={{ gap: 10 }}>
          <Button label={customer?.phone ? `Send to ${firstName(customer.name)} on WhatsApp` : 'Share on WhatsApp'} kind="success" size="lg" block icon={<Share size={20} color="#fff" />}
            onPress={() => void whatsApp(receiptText(ctx), customer?.phone)} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Print" kind="outline" block icon={<Printer size={18} color={c.ink} />} onPress={() => void printHtml(receiptHtml(ctx))} /></View>
            <View style={{ flex: 1 }}><Button label="PDF invoice" kind="outline" block icon={<FileText size={18} color={c.ink} />} onPress={() => void sharePdf(invoiceHtml(ctx), `${bill.no}.pdf`)} /></View>
          </View>
        </View>
      </ScrollView>

      <View style={{ padding: 20, paddingBottom: Math.max(insets.bottom, 16), gap: 4 }}>
        <Button label={labels.newSale} size="lg" block onPress={() => router.replace('/(tabs)/sell')} />
        <Tap onPress={() => router.replace({ pathname: '/bills/[id]', params: { id: bill.id } })} style={{ alignItems: 'center', paddingVertical: 12 }}><T v="bodyStrong" tone="primary">View {labels.sale.toLowerCase()} details</T></Tap>
      </View>
    </View>
  )
}
