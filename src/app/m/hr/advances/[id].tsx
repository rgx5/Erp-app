import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { ask } from '@/ui/overlays'
import { useCan } from '@/data/store'
import { advanceStandings } from '@/modules/hr/logic/advances'
import { livePayslips } from '@/modules/hr/logic/slips'
import { labelYM } from '@/modules/hr/logic/ymd'
import { repayAdvance, writeOffAdvance } from '@/modules/hr/payrollOps'
import { act, Denied, MODE_OPTIONS, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { MoneyField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Card, Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'

/** One advance or loan: what is left, what payroll took, and paying back by hand or writing off. */
export default function AdvancePage() {
  const can = useCan('payroll')
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data } = useHr()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'cash' | 'bank' | 'upi'>('cash')
  const st = advanceStandings(data).find((s) => s.advance.id === id)
  if (!can) return <Denied title="Advance" who="Advances are for the owner and managers with payroll access." />
  if (!st) return <Denied title="Not found" who="This advance is no longer here." />
  const a = st.advance
  const slips = livePayslips(data).filter((p) => p.recoveries.some((r) => r.advanceId === id))
  const repays = Object.values(data.staffRepayments ?? {}).filter((r) => r.advanceId === id)
  return (
    <Screen title={a.no} subtitle={data.employees?.[a.employeeId]?.name} back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <KV k={a.kind === 'loan' ? 'Loan given' : 'Advance given'} v={inr(a.amount, 0)} sub={`${fmtDate(a.date)} · ${a.mode}`} />
          <KV k="Taken from salary" v={inr(st.recovered, 0)} />
          <KV k="Paid back by hand" v={inr(st.repaid, 0)} />
          <KV k="Still to come" v={inr(st.balance, 0)} strong big tone={st.balance ? 'warning' : 'success'} />
          <T v="caption" tone="mute">{inr(st.emi, 0)} a month from {labelYM(a.startMonth)}{a.installments > 1 ? ` · ${a.installments} instalments` : ''}</T>
        </Card>
        {slips.length || repays.length ? (
          <Section title="Payments" style={{ marginTop: 0 }}>
            <Card>
              {slips.map((p) => <KV key={p.id} k={`${labelYM(p.month)} salary`} v={inr(p.recoveries.filter((r) => r.advanceId === id).reduce((t, r) => t + r.amount, 0), 0)} sub={p.no} />)}
              {repays.map((r) => <KV key={r.id} k={r.mode === 'writeoff' ? 'Written off' : 'Paid back'} v={inr(r.amount, 0)} sub={fmtDate(r.date)} />)}
            </Card>
          </Section>
        ) : null}
        {st.balance > 0 ? (
          <View style={{ gap: 10 }}>
            <Button label="Record money paid back" size="lg" block onPress={() => { setAmount(String(st.balance)); setOpen(true) }} />
            <Button label="Write off the rest" kind="outline" block onPress={async () => { if (await ask({ title: `Write off ${inr(st.balance, 0)}?`, message: 'It becomes an expense and the staff member owes nothing.', confirm: 'Write off', cancel: 'Keep' })) act((s, ctx) => writeOffAdvance(s, id, 'Written off', ctx), 'Written off') }} />
          </View>
        ) : null}
      </View>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Money paid back" footer={<View style={{ padding: 16 }}><Button label="Save" size="lg" block onPress={() => { if (act((s, ctx) => repayAdvance(s, id, { amount: Number(amount), mode }, ctx), 'Recorded')) setOpen(false) }} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <MoneyField label="Amount" value={amount} onChange={setAmount} />
          <View style={{ flexDirection: 'row', gap: 8 }}>{MODE_OPTIONS.map((m) => <Chip key={m.value} label={m.label} selected={mode === m.value} onPress={() => setMode(m.value)} />)}</View>
          <T tone="mute">Instalments still come off salary as planned; this reduces what is left.</T>
        </View>
      </Sheet>
    </Screen>
  )
}
