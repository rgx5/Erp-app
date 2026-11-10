import React from 'react'
import { View } from 'react-native'
import { Field, MoneyField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Card, Tap } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import type { PayType } from '@/modules/hr/types'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopEmployeePayProps {
  employeeName: string
  payType: PayType; setPayType: (v: PayType) => void
  basic: string; setBasic: (v: string) => void
  allow: Array<{ name: string; amount: string }>; setAllow: (v: Array<{ name: string; amount: string }> | ((a: Array<{ name: string; amount: string }>) => Array<{ name: string; amount: string }>)) => void
  pf: boolean; setPf: (v: boolean) => void
  esi: boolean; setEsi: (v: boolean) => void
  pt: boolean; setPt: (v: boolean) => void
  tds: boolean; setTds: (v: boolean) => void
  tdsFixed: string; setTdsFixed: (v: string) => void
  ot: boolean; setOt: (v: boolean) => void
  holder: string; setHolder: (v: string) => void
  bankName: string; setBankName: (v: string) => void
  account: string; setAccount: (v: string) => void
  ifsc: string; setIfsc: (v: string) => void
  upi: string; setUpi: (v: string) => void
  pan: string; setPan: (v: string) => void
  uan: string; setUan: (v: string) => void
  esiNo: string; setEsiNo: (v: string) => void
  ratesNote: string
  onSave: () => void
}

/** The desktop pay-terms screen: the exact form `src/app/m/hr/employees/pay.tsx` builds, in the shared settings shell. */
export function DesktopEmployeePay(p: DesktopEmployeePayProps) {
  const { c } = useTheme()
  const unit = p.payType === 'monthly' ? 'per month' : p.payType === 'daily' ? 'per day worked' : 'per hour'
  return (
    <DesktopSettingsPage title="Pay terms" subtitle={p.employeeName} right={<DeskButton label="Save" tone="primary" onPress={p.onSave} />}>
      <Notice tone="primary" title="Check the rates with your accountant" body={p.ratesNote} />
      <Section title="Pay" style={{ marginTop: 18 }}>
        <View style={{ gap: 14 }}>
          <Segmented value={p.payType} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'daily', label: 'Daily wage' }, { value: 'hourly', label: 'Hourly' }]} onChange={p.setPayType} />
          <MoneyField label={p.payType === 'monthly' ? 'Basic pay per month' : p.payType === 'daily' ? 'Rate per day' : 'Rate per hour'} value={p.basic} onChange={p.setBasic} />
        </View>
      </Section>
      <Section title={`Allowances ${unit}`} action="Add" onAction={() => p.setAllow((a) => [...a, { name: '', amount: '' }])}>
        <View style={{ gap: 10 }}>
          {p.allow.map((a, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
              <Field containerStyle={{ flex: 1.4 }} value={a.name} onChangeText={(t) => p.setAllow((l) => l.map((x, k) => (k === i ? { ...x, name: t } : x)))} placeholder="HRA, Travel…" />
              <MoneyField containerStyle={{ flex: 1 }} value={a.amount} onChange={(t) => p.setAllow((l) => l.map((x, k) => (k === i ? { ...x, amount: t } : x)))} />
              <Tap onPress={() => p.setAllow((l) => l.filter((_, k) => k !== i))} style={{ paddingBottom: 14 }}><Trash size={20} color={c.inkMute} /></Tap>
            </View>
          ))}
          {!p.allow.length ? <T tone="mute">None. Add house rent, travel or food allowance if they are part of the pay.</T> : null}
        </View>
      </Section>
      <Section title="Deductions that apply">
        <Card padded={false}>
          <SwitchRow title="Provident fund (PF)" subtitle="Employee and employer share" value={p.pf} onChange={p.setPf} />
          <SwitchRow title="ESI" subtitle="Only while the wage is under the ESI limit" value={p.esi} onChange={p.setEsi} />
          <SwitchRow title="Professional tax" value={p.pt} onChange={p.setPt} />
          <SwitchRow title="TDS on salary" subtitle="Estimated from yearly pay unless you fix an amount" value={p.tds} onChange={p.setTds} />
          {p.payType !== 'hourly' ? <SwitchRow title="Paid for overtime" subtitle="Hours beyond the shift, at the overtime rate" value={p.ot} onChange={p.setOt} /> : null}
        </Card>
        {p.tds ? <MoneyField label="Fixed TDS per month (optional)" value={p.tdsFixed} onChange={p.setTdsFixed} hint="Leave empty to use the estimate" /> : null}
      </Section>
      <Section title="Where the salary goes">
        <View style={{ gap: 14 }}>
          <Field label="Account holder" value={p.holder} onChangeText={p.setHolder} autoCapitalize="words" />
          <Field label="Bank" value={p.bankName} onChangeText={p.setBankName} autoCapitalize="words" />
          <Field label="Account number" value={p.account} onChangeText={p.setAccount} keyboardType="number-pad" />
          <Field label="IFSC" value={p.ifsc} onChangeText={p.setIfsc} autoCapitalize="characters" />
          <Field label="UPI id (if paid by UPI)" value={p.upi} onChangeText={p.setUpi} autoCapitalize="none" />
        </View>
      </Section>
      <Section title="Statutory numbers (optional)">
        <View style={{ gap: 14 }}>
          <Field label="PAN" value={p.pan} onChangeText={p.setPan} autoCapitalize="characters" />
          <Field label="PF UAN" value={p.uan} onChangeText={p.setUan} keyboardType="number-pad" />
          <Field label="ESI number" value={p.esiNo} onChangeText={p.setEsiNo} keyboardType="number-pad" />
        </View>
      </Section>
    </DesktopSettingsPage>
  )
}
