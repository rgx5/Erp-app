import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { currentUser, perform, useApp, useCan } from '@/data/store'
import { openShiftFor, PAY_IN_REASONS, PAY_OUT_REASONS, shiftFigures, varianceLabel } from '@/modules/sales-docs/logic/shifts'
import { addCashMove, closeShift, openShift } from '@/modules/sales-docs/ops'
import { Button } from '@/ui/Button'
import { Field, MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { EmptyState, KV, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { BanknoteDown, BanknoteUp, Clock, Lock, Unlock } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

type Sheeted = null | 'open' | 'in' | 'out' | 'close'

/** Your till: open it with a float, put cash in or take it out, and close it by counting the drawer. */
export default function Shifts() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pos')
  const data = useApp((s) => s.data)
  const me = useApp((s) => currentUser(s))
  const shifts = useList('shifts')
  const users = useList('users')

  const [sheet, setSheet] = useState<Sheeted>(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const now = Date.now()

  if (!can) return <Screen title="Shifts & cash" back><T tone="mute">Shifts are for people who use the billing counter.</T></Screen>
  const mine = me ? openShiftFor(data, me.id) : undefined
  const f = mine ? shiftFigures(data, mine.id, now) : null
  const past = [...shifts].filter((s) => s.status === 'closed').sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)).slice(0, 30)
  const others = shifts.filter((s) => s.status === 'open' && s.id !== mine?.id)
  const who = (id: string) => users.find((u) => u.id === id)?.name ?? 'Staff'

  function show(kind: Exclude<Sheeted, null>) { setAmount(''); setReason(''); setNote(''); setSheet(kind) }
  function run(done: string, fn: () => void) {
    try { fn(); setSheet(null); toast(done, 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  const open = () => run('Shift opened', () => { perform((s, ctx) => openShift(s, Number(amount) || 0, note, ctx)) })
  const move = (kind: 'in' | 'out') => run(kind === 'in' ? 'Cash put in' : 'Cash taken out', () => { perform((s, ctx) => addCashMove(s, mine!.id, { kind, amount: Number(amount) || 0, reason, note }, ctx)) })
  function close() {
    run('Shift closed', () => {
      const r = perform((s, ctx) => closeShift(s, mine!.id, Number(amount) || 0, note, ctx))
      router.push({ pathname: '/m/sales-docs/shifts/[id]', params: { id: r.shift.id } })
    })
  }

  return (
    <Screen title="Shifts & cash" subtitle={mine ? `${mine.no} is open` : 'No shift open'} back>
      <View style={{ gap: 16, paddingBottom: 20 }}>
        {mine && f ? (
          <Card style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Badge tone="success">Open</Badge>
              <T v="caption" tone="mute">since {fmtDateTime(mine.openedAt)}</T>
            </View>
            <KV k="Opening cash" v={inr(f.opening)} />
            <KV k="Cash sales" v={inr(f.cashSales)} sub={`${f.bills} bills`} />
            {f.cashOther ? <KV k="Advances & dues in cash" v={inr(f.cashOther)} /> : null}
            {f.payIns ? <KV k="Cash put in" v={inr(f.payIns)} /> : null}
            {f.payOuts ? <KV k="Cash taken out" v={`− ${inr(f.payOuts)}`} /> : null}
            {f.cashExpenses ? <KV k="Cash expenses" v={`− ${inr(f.cashExpenses)}`} /> : null}
            <KV k="Should be in the drawer" v={inr(f.expected)} strong big />
            {f.byMode.filter((m) => m.mode !== 'cash').map((m) => <KV key={m.mode} k={`Sold by ${m.mode}`} v={inr(m.amount)} />)}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <Button label="Cash in" kind="soft" icon={<BanknoteDown size={18} color={c.primary} />} style={{ flex: 1 }} onPress={() => show('in')} />
              <Button label="Cash out" kind="soft" icon={<BanknoteUp size={18} color={c.primary} />} style={{ flex: 1 }} onPress={() => show('out')} />
            </View>
            <Button label="Close shift" kind="dark" block icon={<Lock size={18} color={c.bg} />} style={{ marginTop: 6 }} onPress={() => show('close')} />
            {f.moves.length ? (
              <View style={{ marginTop: 10 }}>
                {f.moves.map((m) => <KV key={m.id} k={`${m.kind === 'in' ? 'In' : 'Out'} · ${m.reason}`} v={`${m.kind === 'in' ? '+' : '−'} ${inr(m.amount)}`} sub={fmtDateTime(m.date)} tone={m.kind === 'in' ? 'success' : 'default'} />)}
              </View>
            ) : null}
          </Card>
        ) : (
          <EmptyState icon={<Clock size={26} color={c.primary} />} title="Start your shift" hint="Count the cash in the drawer, open the shift, and every sale and cash movement is tied to it until you close." action="Open shift" onAction={() => show('open')} />
        )}

        {others.length ? (
          <Section title="Open on other tills">
            <Card padded={false}>{others.map((s) => <ListRow key={s.id} icon={<Unlock size={18} color={c.warning} />} iconTone="warning" title={who(s.userId)} subtitle={`${s.no} · since ${fmtDateTime(s.openedAt)}`} onPress={() => router.push({ pathname: '/m/sales-docs/shifts/[id]', params: { id: s.id } })} />)}</Card>
          </Section>
        ) : null}

        {past.length ? (
          <Section title="Closed shifts">
            <Card padded={false}>
              {past.map((s) => (
                <ListRow key={s.id} title={`${s.no} · ${who(s.userId)}`} subtitle={fmtDateTime(s.closedAt ?? s.openedAt)} value={varianceLabel(s.variance ?? 0)} valueTone={(s.variance ?? 0) === 0 ? 'success' : 'danger'} sub={`counted ${inr(s.countedCash ?? 0, 0)}`}
                  onPress={() => router.push({ pathname: '/m/sales-docs/shifts/[id]', params: { id: s.id } })} />
              ))}
            </Card>
          </Section>
        ) : null}
      </View>

      <Sheet visible={sheet === 'open'} onClose={() => setSheet(null)} title="Open shift" footer={<Button label="Open shift" size="lg" block onPress={open} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Cash in the drawer now" value={amount} onChange={setAmount} />
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
        </View>
      </Sheet>
      <Sheet visible={sheet === 'in' || sheet === 'out'} onClose={() => setSheet(null)} title={sheet === 'in' ? 'Cash in' : 'Cash out'} subtitle={sheet === 'out' && f ? `${inr(f.expected)} should be in the drawer` : undefined}
        footer={<Button label={sheet === 'in' ? 'Put cash in' : 'Take cash out'} size="lg" block onPress={() => move(sheet === 'in' ? 'in' : 'out')} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Amount" value={amount} onChange={setAmount} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(sheet === 'in' ? PAY_IN_REASONS : PAY_OUT_REASONS).map((r) => <Chip key={r} label={r} selected={reason === r} onPress={() => setReason(r)} />)}
          </View>
          <Field label="What was it for" value={reason} onChangeText={setReason} />
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
        </View>
      </Sheet>
      <Sheet visible={sheet === 'close'} onClose={() => setSheet(null)} title="Close shift" subtitle="Count every note and coin in the drawer" footer={<Button label="Close shift" size="lg" block onPress={close} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Cash counted" value={amount} onChange={setAmount} />
          {f && amount !== '' ? <T tone={(Number(amount) || 0) === f.expected ? 'success' : 'warning'}>{varianceLabel(Math.round(((Number(amount) || 0) - f.expected) * 100) / 100)} (should be {inr(f.expected)})</T> : null}
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
        </View>
      </Sheet>
    </Screen>
  )
}
