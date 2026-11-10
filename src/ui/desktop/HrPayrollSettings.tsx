import React from 'react'
import { View } from 'react-native'
import { Field, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Card, Chip, Tap } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

type SlabRow = { upTo: string; v: string }

export interface DesktopPayrollSettingsProps {
  s: Record<string, string>
  set: (k: string) => (v: string) => void
  pfCap: boolean; setPfCap: (v: boolean) => void
  pfBasis: 'basic' | 'basic+allowances'; setPfBasis: (v: 'basic' | 'basic+allowances') => void
  daysBasis: 'calendar' | 'fixed30'; setDaysBasis: (v: 'calendar' | 'fixed30') => void
  weekoffPaid: boolean; setWeekoffPaid: (v: boolean) => void
  round: boolean; setRound: (v: boolean) => void
  needGeo: boolean; setNeedGeo: (v: boolean) => void
  off: number[]; setOff: (v: number[] | ((w: number[]) => number[])) => void
  pt: SlabRow[]; setPt: (v: SlabRow[]) => void
  tds: SlabRow[]; setTds: (v: SlabRow[]) => void
  weekdays: readonly string[]
  ratesNote: string
  onSave: () => void
  onReset: () => void
}

/** The desktop payroll-settings screen: the exact PF / ESI / PT / TDS and attendance-rules form, in the settings shell. */
export function DesktopPayrollSettings(p: DesktopPayrollSettingsProps) {
  const { c } = useTheme()

  const slabEditor = (title: string, rows: SlabRow[], setRows: (r: SlabRow[]) => void, vLabel: string) => (
    <Section title={title} action="Add slab" onAction={() => setRows([...rows.filter((r) => r.upTo !== ''), { upTo: String((Number(rows.filter((r) => r.upTo !== '').pop()?.upTo) || 0) + 1000), v: '0' }, ...rows.filter((r) => r.upTo === '')])}>
      <View style={{ gap: 8 }}>
        {rows.map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <Field containerStyle={{ flex: 1 }} label={i === 0 ? 'Up to (blank = no limit)' : undefined} value={r.upTo} onChangeText={(t) => setRows(rows.map((x, k) => (k === i ? { ...x, upTo: t.replace(/[^\d]/g, '') } : x)))} keyboardType="number-pad" placeholder="No limit" />
            <Field containerStyle={{ flex: 1 }} label={i === 0 ? vLabel : undefined} value={r.v} onChangeText={(t) => setRows(rows.map((x, k) => (k === i ? { ...x, v: t } : x)))} keyboardType="decimal-pad" />
            <Tap onPress={() => setRows(rows.filter((_, k) => k !== i))} style={{ paddingBottom: 14 }}><Trash size={20} color={c.inkMute} /></Tap>
          </View>
        ))}
      </View>
    </Section>
  )

  return (
    <DesktopSettingsPage title="Payroll settings" subtitle="PF, ESI, PT, TDS and how pay is worked out" right={<DeskButton label="Save" tone="primary" onPress={p.onSave} />} maxWidth={820}>
      <Notice tone="warning" title="Defaults, not advice" body={p.ratesNote} />
      <Section title="Provident fund" style={{ marginTop: 18 }}>
        <View style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumberField containerStyle={{ flex: 1 }} label="Employee %" value={p.s.pfEmployeePct} onChange={p.set('pfEmployeePct')} decimals />
            <NumberField containerStyle={{ flex: 1 }} label="Employer %" value={p.s.pfEmployerPct} onChange={p.set('pfEmployerPct')} decimals />
          </View>
          <NumberField label="Wage ceiling per month" value={p.s.pfWageCeiling} onChange={p.set('pfWageCeiling')} />
          <Card padded={false}><SwitchRow title="Stop at the ceiling" subtitle="Off to work PF on the full wage" value={p.pfCap} onChange={p.setPfCap} /></Card>
          <Segmented value={p.pfBasis} options={[{ value: 'basic', label: 'On basic' }, { value: 'basic+allowances', label: 'Basic + allowances' }]} onChange={p.setPfBasis} />
        </View>
      </Section>
      <Section title="ESI">
        <View style={{ gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumberField containerStyle={{ flex: 1 }} label="Employee %" value={p.s.esiEmployeePct} onChange={p.set('esiEmployeePct')} decimals />
            <NumberField containerStyle={{ flex: 1 }} label="Employer %" value={p.s.esiEmployerPct} onChange={p.set('esiEmployerPct')} decimals />
          </View>
          <NumberField label="Applies up to a wage of" value={p.s.esiWageCeiling} onChange={p.set('esiWageCeiling')} />
        </View>
      </Section>
      {slabEditor('Professional tax (monthly, by gross pay)', p.pt, p.setPt, 'Tax ₹')}
      <Section title="TDS estimate (yearly income)">
        <View style={{ gap: 14 }}>
          <NumberField label="Standard deduction" value={p.s.tdsStandardDeduction} onChange={p.set('tdsStandardDeduction')} />
          <NumberField label="No tax up to taxable income of" value={p.s.tdsRebateLimit} onChange={p.set('tdsRebateLimit')} />
          <NumberField label="Cess %" value={p.s.tdsCessPct} onChange={p.set('tdsCessPct')} decimals />
        </View>
      </Section>
      {slabEditor('Income tax slabs', p.tds, p.setTds, 'Rate %')}
      <Section title="How pay is worked out">
        <View style={{ gap: 14 }}>
          <Segmented value={p.daysBasis} options={[{ value: 'calendar', label: 'Calendar days' }, { value: 'fixed30', label: 'Always 30 days' }]} onChange={p.setDaysBasis} />
          <Card padded={false}>
            <SwitchRow title="Pay weekly off to daily-wage staff" value={p.weekoffPaid} onChange={p.setWeekoffPaid} />
            <SwitchRow title="Round net pay to the rupee" value={p.round} onChange={p.setRound} />
          </Card>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumberField containerStyle={{ flex: 1 }} label="Overtime rate ×" value={p.s.overtimeMultiplier} onChange={p.set('overtimeMultiplier')} decimals />
            <NumberField containerStyle={{ flex: 1 }} label="Ignore overtime under (min)" value={p.s.overtimeMinMins} onChange={p.set('overtimeMinMins')} />
          </View>
          <NumberField label="Minutes in a normal working day" value={p.s.workDayMins} onChange={p.set('workDayMins')} />
          <NumberField label="Salary day of the month (1–28)" value={p.s.payDay} onChange={p.set('payDay')} hint="Home reminds you if last month's payroll is not run by then" />
        </View>
      </Section>
      <Section title="Leave and attendance">
        <View style={{ gap: 14 }}>
          <NumberField label="Leave year starts in month (1 = January, 4 = April)" value={p.s.leaveYearStartMonth} onChange={p.set('leaveYearStartMonth')} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {p.weekdays.map((d, i) => <Chip key={d} label={d} selected={p.off.includes(i)} onPress={() => p.setOff((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} />)}
          </View>
          <T v="caption" tone="mute">The weekly off given to new employees.</T>
          <Field label="Punch-in hint (optional)" value={p.s.geoNote} onChangeText={p.set('geoNote')} placeholder="Within 100 m of the shop" />
          <Card padded={false}><SwitchRow title="Ask where staff are when they punch" subtitle="A note in words — no location permission needed" value={p.needGeo} onChange={p.setNeedGeo} /></Card>
        </View>
      </Section>
      <DeskButton label="Reset to the defaults" onPress={p.onReset} />
    </DesktopSettingsPage>
  )
}
