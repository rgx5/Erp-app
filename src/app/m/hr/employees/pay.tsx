import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { savePay } from '@/modules/hr/ops'
import type { PayAllowance, PayType } from '@/modules/hr/types'
import { act, Denied, RATES_NOTE, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, MoneyField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Tap } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** How a person is paid: pay type and amounts, allowances, PF/ESI/PT/TDS, overtime and bank details. */
export default function PayTerms() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('payroll')
  const { data } = useHr()
  const e = data.employees?.[id]
  const cur = data.employeePay?.[id]
  const [payType, setPayType] = useState<PayType>(cur?.payType ?? 'monthly')
  const [basic, setBasic] = useState(cur ? String(cur.basic) : '')
  const [allow, setAllow] = useState<Array<{ name: string; amount: string }>>((cur?.allowances ?? []).map((a) => ({ name: a.name, amount: String(a.amount) })))
  const [pf, setPf] = useState(cur?.pf ?? false)
  const [esi, setEsi] = useState(cur?.esi ?? false)
  const [pt, setPt] = useState(cur?.pt ?? false)
  const [tds, setTds] = useState(cur?.tds ?? false)
  const [tdsFixed, setTdsFixed] = useState(cur?.tdsMonthly !== undefined ? String(cur.tdsMonthly) : '')
  const [ot, setOt] = useState(cur?.overtimeEligible ?? false)
  const [holder, setHolder] = useState(cur?.bank.holder ?? e?.name ?? '')
  const [bankName, setBankName] = useState(cur?.bank.bankName ?? '')
  const [account, setAccount] = useState(cur?.bank.account ?? '')
  const [ifsc, setIfsc] = useState(cur?.bank.ifsc ?? '')
  const [upi, setUpi] = useState(cur?.bank.upi ?? '')
  const [pan, setPan] = useState(cur?.pan ?? '')
  const [uan, setUan] = useState(cur?.uan ?? '')
  const [esiNo, setEsiNo] = useState(cur?.esiNo ?? '')

  if (!can) return <Denied title="Pay terms" who="Pay is for the owner and managers with payroll access." />
  if (!e) return <Denied title="Not found" who="This employee is no longer here." />
  const unit = payType === 'monthly' ? 'per month' : payType === 'daily' ? 'per day worked' : 'per hour'

  function save() {
    const allowances: PayAllowance[] = allow.map((a) => ({ name: a.name, amount: Number(a.amount) || 0 }))
    const r = act((s, ctx) => savePay(s, id, {
      payType, basic: Number(basic), allowances, pf, esi, pt, tds, tdsMonthly: tds && tdsFixed.trim() ? Number(tdsFixed) : undefined, overtimeEligible: ot,
      bank: { holder, bankName, account, ifsc, upi }, pan, uan, esiNo, notes: '',
    }, ctx), 'Pay terms saved')
    if (r) router.back()
  }

  return (
    <Screen title="Pay terms" subtitle={e.name} back footer={<Button label="Save" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Notice tone="primary" title="Check the rates with your accountant" body={RATES_NOTE} />
        <Section title="Pay" style={{ marginTop: 0 }}>
          <View style={{ gap: 14 }}>
            <Segmented value={payType} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'daily', label: 'Daily wage' }, { value: 'hourly', label: 'Hourly' }]} onChange={setPayType} />
            <MoneyField label={payType === 'monthly' ? 'Basic pay per month' : payType === 'daily' ? 'Rate per day' : 'Rate per hour'} value={basic} onChange={setBasic} />
          </View>
        </Section>
        <Section title={`Allowances ${unit}`} style={{ marginTop: 6 }} action="Add" onAction={() => setAllow((a) => [...a, { name: '', amount: '' }])}>
          <View style={{ gap: 10 }}>
            {allow.map((a, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <Field containerStyle={{ flex: 1.4 }} value={a.name} onChangeText={(t) => setAllow((l) => l.map((x, k) => (k === i ? { ...x, name: t } : x)))} placeholder="HRA, Travel…" />
                <MoneyField containerStyle={{ flex: 1 }} value={a.amount} onChange={(t) => setAllow((l) => l.map((x, k) => (k === i ? { ...x, amount: t } : x)))} />
                <Tap onPress={() => setAllow((l) => l.filter((_, k) => k !== i))} style={{ paddingBottom: 14 }}><Trash size={20} color={c.inkMute} /></Tap>
              </View>
            ))}
            {!allow.length ? <T tone="mute">None. Add house rent, travel or food allowance if they are part of the pay.</T> : null}
          </View>
        </Section>
        <Section title="Deductions that apply" style={{ marginTop: 6 }}>
          <Card padded={false}>
            <SwitchRow title="Provident fund (PF)" subtitle="Employee and employer share" value={pf} onChange={setPf} />
            <SwitchRow title="ESI" subtitle="Only while the wage is under the ESI limit" value={esi} onChange={setEsi} />
            <SwitchRow title="Professional tax" value={pt} onChange={setPt} />
            <SwitchRow title="TDS on salary" subtitle="Estimated from yearly pay unless you fix an amount" value={tds} onChange={setTds} />
            {payType !== 'hourly' ? <SwitchRow title="Paid for overtime" subtitle="Hours beyond the shift, at the overtime rate" value={ot} onChange={setOt} /> : null}
          </Card>
          {tds ? <MoneyField label="Fixed TDS per month (optional)" value={tdsFixed} onChange={setTdsFixed} hint="Leave empty to use the estimate" /> : null}
        </Section>
        <Section title="Where the salary goes" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <Field label="Account holder" value={holder} onChangeText={setHolder} autoCapitalize="words" />
            <Field label="Bank" value={bankName} onChangeText={setBankName} autoCapitalize="words" />
            <Field label="Account number" value={account} onChangeText={setAccount} keyboardType="number-pad" />
            <Field label="IFSC" value={ifsc} onChangeText={setIfsc} autoCapitalize="characters" />
            <Field label="UPI id (if paid by UPI)" value={upi} onChangeText={setUpi} autoCapitalize="none" />
          </View>
        </Section>
        <Section title="Statutory numbers (optional)" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <Field label="PAN" value={pan} onChangeText={setPan} autoCapitalize="characters" />
            <Field label="PF UAN" value={uan} onChangeText={setUan} keyboardType="number-pad" />
            <Field label="ESI number" value={esiNo} onChangeText={setEsiNo} keyboardType="number-pad" />
          </View>
        </Section>
      </View>
    </Screen>
  )
}
