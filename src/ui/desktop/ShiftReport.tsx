import React from 'react'
import { ScrollView, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList, useStore } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { printHtml, sharePdf, whatsApp } from '@/features/share'
import { shiftHtml, shiftText } from '@/modules/sales-docs/html'
import { shiftFigures, varianceLabel } from '@/modules/sales-docs/logic/shifts'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Printer, Send, Share } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, Pill, Toolbar, dtext } from './kit'

/**
 * The desktop shift report: the same figures as `src/app/m/sales-docs/shifts/[id].tsx` laid out as cards in a
 * centred column under desktop chrome, with the sharing actions in the toolbar instead of stacked buttons.
 */
export function DesktopShiftReport() {
  const { c } = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('pos')
  const store = useStore()
  const data = useApp((s) => s.data)
  const shift = useList('shifts').find((x) => x.id === id)
  const users = useList('users')

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Shift" />}>
        <View style={{ padding: 20 }}><T tone="mute">Shifts are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }
  if (!shift) {
    return (
      <DeskPage toolbar={<Toolbar title="Not found" />}>
        <View style={{ padding: 20 }}><T tone="mute">This shift is no longer here.</T></View>
      </DeskPage>
    )
  }

  const f = shiftFigures(data, shift.id, Date.now())!
  const who = users.find((u) => u.id === shift.userId)?.name ?? 'Staff'
  const closed = shift.status === 'closed'

  return (
    <DeskPage
      toolbar={
        <Toolbar title={shift.no} subtitle={who} right={
          <>
            <DeskButton label="WhatsApp" icon={<Send size={14} color={c.primary} />} onPress={() => whatsApp(shiftText(shift, f, store.name, who))} />
            <DeskButton label="PDF" icon={<Share size={14} color={c.ink} />} onPress={() => sharePdf(shiftHtml(shift, f, store, who), `${shift.no}.pdf`)} />
            <DeskButton label="Print" icon={<Printer size={14} color={c.ink} />} onPress={() => printHtml(shiftHtml(shift, f, store, who))} />
          </>
        } />
      }
    >
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ alignItems: 'center', padding: 28 }}>
        <View style={{ width: '100%', maxWidth: 640, gap: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pill tone={closed ? 'default' : 'success'} label={closed ? 'Closed' : 'Open'} />
            <T style={[dtext.tiny, { color: c.inkMute }]}>{fmtDateTime(shift.openedAt)}{shift.closedAt ? ` → ${fmtDateTime(shift.closedAt)}` : ''}</T>
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <KV k="Opening cash" v={inr(f.opening)} />
            <KV k="Cash sales" v={inr(f.cashSales)} sub={`${f.bills} bills`} />
            {f.cashOther ? <KV k="Advances & dues in cash" v={inr(f.cashOther)} /> : null}
            <KV k="Cash put in" v={inr(f.payIns)} />
            <KV k="Cash taken out" v={`− ${inr(f.payOuts)}`} />
            <KV k="Cash expenses" v={`− ${inr(f.cashExpenses)}`} />
            <KV k="Should be in the drawer" v={inr(closed ? shift.expectedCash ?? f.expected : f.expected)} strong big />
            {closed ? <KV k="Counted" v={inr(shift.countedCash ?? 0)} /> : null}
            {closed ? <KV k="Difference" v={varianceLabel(shift.variance ?? 0)} strong tone={(shift.variance ?? 0) === 0 ? 'success' : 'danger'} /> : null}
          </View>

          {f.byMode.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Sales by how they were paid</T>
              {f.byMode.map((m) => <KV key={m.mode} k={m.mode.toUpperCase()} v={inr(m.amount)} />)}
            </View>
          ) : null}

          {f.moves.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Cash in and out</T>
              {f.moves.map((m) => <KV key={m.id} k={`${m.kind === 'in' ? 'In' : 'Out'} · ${m.reason}`} v={`${m.kind === 'in' ? '+' : '−'} ${inr(m.amount)}`} sub={fmtDateTime(m.date)} />)}
            </View>
          ) : null}

          {shift.note ? <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}><T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Note</T><T style={dtext.cell}>{shift.note}</T></View> : null}
        </View>
      </ScrollView>
    </DeskPage>
  )
}
