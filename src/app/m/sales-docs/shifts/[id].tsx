import React from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { printHtml, sharePdf, whatsApp } from '@/features/share'
import { shiftHtml, shiftText } from '@/modules/sales-docs/html'
import { shiftFigures, varianceLabel } from '@/modules/sales-docs/logic/shifts'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Printer, Send, Share } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** One shift's report: where the drawer started, what moved, what it should hold and what was counted. */
export default function ShiftReport() {
  const { c } = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('pos')
  const store = useStore()
  const data = useApp((s) => s.data)
  const shift = useList('shifts').find((x) => x.id === id)
  const users = useList('users')

  if (!can) return <Screen title="Shift" back><T tone="mute">Shifts are for people who use the billing counter.</T></Screen>
  if (!shift) return <Screen title="Not found" back><T tone="mute">This shift is no longer here.</T></Screen>
  const f = shiftFigures(data, shift.id, Date.now())!
  const who = users.find((u) => u.id === shift.userId)?.name ?? 'Staff'
  const closed = shift.status === 'closed'

  return (
    <Screen title={shift.no} subtitle={who} back>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Badge tone={closed ? 'default' : 'success'}>{closed ? 'Closed' : 'Open'}</Badge>
          <T v="caption" tone="mute">{fmtDateTime(shift.openedAt)}{shift.closedAt ? ` → ${fmtDateTime(shift.closedAt)}` : ''}</T>
        </View>
        <Card>
          <KV k="Opening cash" v={inr(f.opening)} />
          <KV k="Cash sales" v={inr(f.cashSales)} sub={`${f.bills} bills`} />
          {f.cashOther ? <KV k="Advances & dues in cash" v={inr(f.cashOther)} /> : null}
          <KV k="Cash put in" v={inr(f.payIns)} />
          <KV k="Cash taken out" v={`− ${inr(f.payOuts)}`} />
          <KV k="Cash expenses" v={`− ${inr(f.cashExpenses)}`} />
          <KV k="Should be in the drawer" v={inr(closed ? shift.expectedCash ?? f.expected : f.expected)} strong big />
          {closed ? <KV k="Counted" v={inr(shift.countedCash ?? 0)} /> : null}
          {closed ? <KV k="Difference" v={varianceLabel(shift.variance ?? 0)} strong tone={(shift.variance ?? 0) === 0 ? 'success' : 'danger'} /> : null}
        </Card>
        {f.byMode.length ? (
          <Section title="Sales by how they were paid">
            <Card>{f.byMode.map((m) => <KV key={m.mode} k={m.mode.toUpperCase()} v={inr(m.amount)} />)}</Card>
          </Section>
        ) : null}
        {f.moves.length ? (
          <Section title="Cash in and out">
            <Card>{f.moves.map((m) => <KV key={m.id} k={`${m.kind === 'in' ? 'In' : 'Out'} · ${m.reason}`} v={`${m.kind === 'in' ? '+' : '−'} ${inr(m.amount)}`} sub={fmtDateTime(m.date)} />)}</Card>
          </Section>
        ) : null}
        {shift.note ? <Card><T v="label" tone="soft">NOTE</T><T>{shift.note}</T></Card> : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button label="WhatsApp" kind="soft" icon={<Send size={18} color={c.primary} />} style={{ flex: 1 }} onPress={() => whatsApp(shiftText(shift, f, store.name, who))} />
          <Button label="PDF" kind="outline" icon={<Share size={18} color={c.ink} />} style={{ flex: 1 }} onPress={() => sharePdf(shiftHtml(shift, f, store, who), `${shift.no}.pdf`)} />
          <Button label="Print" kind="outline" icon={<Printer size={18} color={c.ink} />} style={{ flex: 1 }} onPress={() => printHtml(shiftHtml(shift, f, store, who))} />
        </View>
      </View>
    </Screen>
  )
}
