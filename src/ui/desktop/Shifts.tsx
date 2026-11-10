import React, { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { currentUser, perform, useApp, useCan } from '@/data/store'
import { openShiftFor, PAY_IN_REASONS, PAY_OUT_REASONS, shiftFigures, varianceLabel } from '@/modules/sales-docs/logic/shifts'
import { addCashMove, closeShift, openShift } from '@/modules/sales-docs/ops'
import { Field, MoneyField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { BanknoteDown, BanknoteUp, Lock, Unlock } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, dtext, type Column } from './kit'

type Sheeted = null | 'open' | 'in' | 'out' | 'close'
type ClosedRow = { id: string; no: string; who: string; closedAt: number; variance: number; counted: number }

/**
 * The desktop Shifts & cash screen: a KPI strip for the open till's headline numbers, a dense grid of closed
 * shifts, and a side panel for other open tills and cash movements — instead of the phone's single stacked card.
 * Every figure comes from the same `shiftFigures`/`openShiftFor` the phone `m/sales-docs/shifts/index.tsx` calls.
 */
export function DesktopShifts() {
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

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Shifts & cash" />}>
        <View style={{ padding: 20 }}><T tone="mute">Shifts are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

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

  const closedRows: ClosedRow[] = past.map((s) => ({ id: s.id, no: s.no, who: who(s.userId), closedAt: s.closedAt ?? s.openedAt, variance: s.variance ?? 0, counted: s.countedCash ?? 0 }))
  const columns: Array<Column<ClosedRow>> = [
    { key: 'no', label: 'Shift', sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.no}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.who} · {fmtDateTime(r.closedAt)}</T>
      </View>
    ) },
    { key: 'counted', label: 'Counted', width: 120, align: 'right', sortValue: (r) => r.counted, render: (r) => cellNum(inr(r.counted, 0)) },
    { key: 'variance', label: 'Difference', width: 130, align: 'right', sortValue: (r) => r.variance, render: (r) => (r.variance === 0 ? <Pill tone="success" label="Matched" /> : <Pill tone="danger" label={varianceLabel(r.variance)} />) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Shifts & cash"
          subtitle={mine ? `${mine.no} is open` : 'No shift open'}
          right={mine && f ? (
            <>
              <DeskButton label="Cash in" icon={<BanknoteDown size={14} color={c.primary} />} onPress={() => show('in')} />
              <DeskButton label="Cash out" icon={<BanknoteUp size={14} color={c.primary} />} onPress={() => show('out')} />
              <DeskButton label="Close shift" tone="primary" icon={<Lock size={14} color={c.onPrimary} />} onPress={() => show('close')} />
            </>
          ) : <DeskButton label="Open shift" tone="primary" onPress={() => show('open')} />}
        />
      }
    >
      {mine && f ? (
        <KpiStrip>
          <KpiTile label="Should be in the drawer" value={inr(f.expected, 0)} tone="primary" delta={`since ${fmtDateTime(mine.openedAt)}`} />
          <KpiTile label="Cash sales" value={inr(f.cashSales, 0)} delta={`${f.bills} bills`} />
          <KpiTile label="Opening cash" value={inr(f.opening, 0)} />
          {f.payIns ? <KpiTile label="Cash put in" value={inr(f.payIns, 0)} tone="success" /> : null}
          {f.payOuts ? <KpiTile label="Cash taken out" value={inr(f.payOuts, 0)} tone="warning" /> : null}
        </KpiStrip>
      ) : null}

      <SplitPane widths={['flex', 300]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={closedRows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/sales-docs/shifts/[id]', params: { id: r.id } })} emptyLabel="No closed shifts yet" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          {mine && f && f.byMode.filter((m) => m.mode !== 'cash').length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 2 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 4 }]}>Sold by other modes</T>
              {f.byMode.filter((m) => m.mode !== 'cash').map((m) => <KV key={m.mode} k={`Sold by ${m.mode}`} v={inr(m.amount)} />)}
            </View>
          ) : null}
          {mine && f && f.moves.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 2 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 4 }]}>Cash in and out</T>
              {f.moves.map((m) => <KV key={m.id} k={`${m.kind === 'in' ? 'In' : 'Out'} · ${m.reason}`} v={`${m.kind === 'in' ? '+' : '−'} ${inr(m.amount)}`} sub={fmtDateTime(m.date)} tone={m.kind === 'in' ? 'success' : undefined} />)}
            </View>
          ) : null}
          {others.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 4 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 4 }]}>Open on other tills</T>
              {others.map((s) => (
                <DeskButton key={s.id} label={`${who(s.userId)} · ${s.no}`} icon={<Unlock size={14} color={c.warning} />} onPress={() => router.push({ pathname: '/m/sales-docs/shifts/[id]', params: { id: s.id } })} />
              ))}
            </View>
          ) : null}
          {!mine ? <T tone="mute">Count the cash in the drawer, open the shift, and every sale and cash movement is tied to it until you close.</T> : null}
        </ScrollView>
      </SplitPane>

      <Sheet visible={sheet === 'open'} onClose={() => setSheet(null)} title="Open shift" footer={<DeskButton label="Open shift" tone="primary" onPress={open} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Cash in the drawer now" value={amount} onChange={setAmount} />
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
        </View>
      </Sheet>
      <Sheet visible={sheet === 'in' || sheet === 'out'} onClose={() => setSheet(null)} title={sheet === 'in' ? 'Cash in' : 'Cash out'} subtitle={sheet === 'out' && f ? `${inr(f.expected)} should be in the drawer` : undefined}
        footer={<DeskButton label={sheet === 'in' ? 'Put cash in' : 'Take cash out'} tone="primary" onPress={() => move(sheet === 'in' ? 'in' : 'out')} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Amount" value={amount} onChange={setAmount} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(sheet === 'in' ? PAY_IN_REASONS : PAY_OUT_REASONS).map((r) => <Pressable key={r} onPress={() => setReason(r)}><Pill label={r} tone={reason === r ? 'primary' : 'default'} /></Pressable>)}
          </View>
          <Field label="What was it for" value={reason} onChangeText={setReason} />
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
        </View>
      </Sheet>
      <Sheet visible={sheet === 'close'} onClose={() => setSheet(null)} title="Close shift" subtitle="Count every note and coin in the drawer" footer={<DeskButton label="Close shift" tone="primary" onPress={close} />}>
        <View style={{ gap: 14 }}>
          <MoneyField label="Cash counted" value={amount} onChange={setAmount} />
          {f && amount !== '' ? <T tone={(Number(amount) || 0) === f.expected ? 'success' : 'warning'}>{varianceLabel(Math.round(((Number(amount) || 0) - f.expected) * 100) / 100)} (should be {inr(f.expected)})</T> : null}
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
        </View>
      </Sheet>
    </DeskPage>
  )
}
