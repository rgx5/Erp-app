import React, { useMemo, useState } from 'react'
import { Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate, fmtDateTime, isThisMonth, monthDay, timeAgo } from '@/domain/dates'
import { inr, inr0, num } from '@/domain/money'
import { payLabel } from '@/domain/receipt'
import { customerStats } from '@/domain/stock'
import { useLabels, useList, useStore } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { useCart } from '@/features/cart'
import { whatsApp } from '@/features/share'
import { Button, IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Group, Tap } from '@/ui/primitives'
import { KV, Notice, Section, StatTile } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Cake, ChevronRight, Gift, HandCoins, Pencil, Phone, Plus, ReceiptText, Return, Share, Wallet } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { PanelSlot } from '@/modules/PanelSlot'

const HISTORY_SHOWN = 12

export default function CustomerProfile() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const store = useStore()
  const customer = useApp((s) => s.data.customers[id])
  const allBills = useList('bills')
  const canEdit = useCan('customers')
  const canPos = useCan('pos')
  const [all, setAll] = useState(false)

  const bills = useMemo(() => allBills.filter((b) => b.customerId === id && b.status !== 'held').sort((a, b) => b.date - a.date), [allBills, id])
  const stats = useMemo(() => customerStats(id, bills), [id, bills])
  if (!customer) return <Screen title="Not found" back><T tone="mute">This {labels.customer.toLowerCase()} is no longer here.</T></Screen>

  const first = customer.name.split(/\s+/)[0]
  const loyalty = store.loyaltyEarnPct > 0 || customer.loyaltyPoints > 0
  const pointsValue = customer.loyaltyPoints * store.loyaltyRedeemValue
  const birthday = isThisMonth(customer.dob)
  const anniversary = isThisMonth(customer.anniversary)
  const shown = all ? bills : bills.slice(0, HISTORY_SHOWN)

  const call = () => Linking.openURL(`tel:${customer!.phone}`).catch(() => toast('Could not open the dialler', 'err'))
  const mail = () => Linking.openURL(`mailto:${customer!.email}`).catch(() => toast('Could not open email', 'err'))
  const wish = () => void whatsApp(`Hi ${first}, warm wishes from ${store.name}! ${birthday ? 'Happy birthday — have a wonderful day.' : 'Happy anniversary — thank you for being with us.'}`, customer!.phone)
  const sell = () => { useCart.getState().set({ customerId: customer!.id }); router.push('/(tabs)/sell') }

  const dateRow = (label: string, v: string) => (v ? <KV k={label} v={monthDay(v) ? fmtDate(new Date(`${v}T12:00:00`).getTime()) : v} /> : null)

  return (
    <Screen title={customer.name} subtitle={customer.phone} back
      right={canEdit ? <IconButton label="Edit" onPress={() => router.push({ pathname: '/customers/new', params: { id: customer.id } })}><Pencil size={19} color={c.ink} /></IconButton> : undefined}>
      <View style={{ gap: 14, paddingTop: 4 }}>
        <Card style={{ alignItems: 'center', gap: 10 }}>
          <Avatar name={customer.name} size={68} />
          <View style={{ alignItems: 'center', gap: 2 }}>
            <T v="h1" align="center" numberOfLines={2}>{customer.name}</T>
            <T tone="mute">{customer.phone}</T>
            <T v="caption" tone="mute">{labels.customer} since {fmtDate(customer.createdAt)}</T>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {birthday ? <Badge tone="accent" icon={<Cake size={12} color={c.accent} />}>Birthday this month</Badge> : null}
            {anniversary ? <Badge tone="accent" icon={<Gift size={12} color={c.accent} />}>Anniversary this month</Badge> : null}
            {customer.storeCredit > 0 ? <Badge tone="success">{inr0(customer.storeCredit)} credit</Badge> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <Button label="Call" kind="soft" size="sm" icon={<Phone size={16} color={c.primary} />} onPress={call} />
            <Button label="WhatsApp" kind="success" size="sm" icon={<Share size={16} color="#fff" />} onPress={() => void whatsApp(`Hi ${first}, this is ${store.name}.`, customer.phone)} />
            {customer.email ? <Button label="Email" kind="outline" size="sm" onPress={mail} /> : null}
          </View>
        </Card>

        {birthday || anniversary ? <Notice tone="accent" icon={<Cake size={20} color={c.accent} />} title={`Send ${first} your wishes`} body={`${birthday ? 'Birthday' : 'Anniversary'} this month · a warm message keeps ${labels.customers.toLowerCase()} coming back`} action="Send" onAction={wish} /> : null}

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <StatTile label="Total spent" value={inr0(stats.spent)} icon={<Wallet size={16} color={c.primary} />} foot={stats.bills ? `${stats.bills} ${stats.bills === 1 ? labels.sale.toLowerCase() : labels.sales.toLowerCase()}` : 'No purchases yet'} />
          <StatTile label="Average bill" value={stats.bills ? inr0(stats.avg) : '—'} icon={<ReceiptText size={16} color={c.series[2]} />} tone="accent" foot={stats.last ? `Last ${timeAgo(stats.last)}` : undefined} />
        </View>

        {loyalty || customer.storeCredit > 0 ? (
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {loyalty ? <StatTile label="Reward points" value={num(customer.loyaltyPoints)} icon={<Gift size={16} color={c.series[3]} />} tone="primary" foot={pointsValue > 0 ? `Worth ${inr0(pointsValue)}` : 'Earned on every bill'} /> : null}
            <StatTile label="Store credit" value={inr0(customer.storeCredit)} icon={<HandCoins size={16} color={c.success} />} tone="success" foot={customer.storeCredit > 0 ? 'Use it at the counter' : 'From returns'} />
          </View>
        ) : null}

        {canPos ? <Button label={`New ${labels.sale.toLowerCase()} for ${first}`} size="lg" block icon={<Plus size={20} color="#fff" />} onPress={sell} /> : null}

        {customer.email || customer.address || customer.gstin || customer.dob || customer.anniversary || customer.notes ? (
          <Section title="Details" style={{ marginTop: 6 }}>
            <Card>
              {customer.email ? <KV k="Email" v={customer.email} /> : null}
              {customer.address ? <KV k="Address" v={customer.address} /> : null}
              {customer.gstin ? <KV k="GSTIN" v={customer.gstin} /> : null}
              {dateRow('Birthday', customer.dob)}
              {dateRow('Anniversary', customer.anniversary)}
              {customer.notes ? <KV k="Notes" v={customer.notes} /> : null}
            </Card>
          </Section>
        ) : null}

        <PanelSlot slot="customer" customer={customer} />

        <Section title="Purchase history" action={bills.length > HISTORY_SHOWN ? (all ? 'Show less' : `All ${bills.length}`) : undefined} onAction={() => setAll(!all)} style={{ marginTop: 6 }}>
          {bills.length ? (
            <Group>
              {shown.map((b) => {
                const credit = !!b.refundOfBillId || b.total < 0
                return (
                  <Tap key={b.id} onPress={() => router.push({ pathname: '/bills/[id]', params: { id: b.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 }}>
                    <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: credit ? c.dangerTint : c.primaryTint }}>
                      {credit ? <Return size={17} color={c.danger} /> : <ReceiptText size={17} color={c.primary} />}
                    </View>
                    <View style={{ flex: 1, gap: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>{b.no}</T>
                      <T v="caption" tone="mute" numberOfLines={1}>{fmtDateTime(b.date)}{b.payments.length ? ` · ${[...new Set(b.payments.map(payLabel))].join(' + ')}` : ''}</T>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <T v="num" tone={b.total < 0 ? 'danger' : 'default'}>{inr(b.total, 0)}</T>
                      <T v="micro" tone="mute">{b.items.length} {b.items.length === 1 ? 'item' : 'items'}</T>
                    </View>
                    <ChevronRight size={16} color={c.inkMute} />
                  </Tap>
                )
              })}
            </Group>
          ) : (
            <Card><T tone="mute" align="center">No purchases yet. Add {first} to a {labels.sale.toLowerCase()} at the counter and it will show up here.</T></Card>
          )}
        </Section>
      </View>
    </Screen>
  )
}
