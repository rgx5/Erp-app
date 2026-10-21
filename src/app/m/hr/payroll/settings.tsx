import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { DEFAULT_HR_SETTINGS, hrSettings } from '@/modules/hr/logic/settings'
import { WEEKDAYS } from '@/modules/hr/logic/ymd'
import { saveHrSettings } from '@/modules/hr/ops'
import type { HrSettings } from '@/modules/hr/types'
import { act, Denied, RATES_NOTE, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip, Tap } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

type SlabRow = { upTo: string; v: string }
const toRows = (list: Array<{ upTo: number | null; amount?: number; ratePct?: number }>, key: 'amount' | 'ratePct'): SlabRow[] => list.map((s) => ({ upTo: s.upTo === null ? '' : String(s.upTo), v: String(s[key] ?? 0) }))
const fromRows = (rows: SlabRow[]) => rows.map((r) => ({ upTo: r.upTo.trim() === '' ? null : Number(r.upTo), v: Number(r.v) || 0 }))

/** PF, ESI, professional tax and TDS rates, and how pay is worked out. They start as common defaults — the owner’s accountant confirms them. */
export default function PayrollSettings() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('payroll')
  const { data } = useHr()
  const cur = hrSettings(data)
  const [s, setS] = useState({
    pfEmployeePct: String(cur.pfEmployeePct), pfEmployerPct: String(cur.pfEmployerPct), pfWageCeiling: String(cur.pfWageCeiling), esiEmployeePct: String(cur.esiEmployeePct), esiEmployerPct: String(cur.esiEmployerPct),
    esiWageCeiling: String(cur.esiWageCeiling), tdsStandardDeduction: String(cur.tdsStandardDeduction), tdsRebateLimit: String(cur.tdsRebateLimit), tdsCessPct: String(cur.tdsCessPct),
    overtimeMultiplier: String(cur.overtimeMultiplier), overtimeMinMins: String(cur.overtimeMinMins), workDayMins: String(cur.workDayMins), leaveYearStartMonth: String(cur.leaveYearStartMonth), payDay: String(cur.payDay), geoNote: cur.geoNote,
  })
  const [pfCap, setPfCap] = useState(cur.pfCap)
  const [pfBasis, setPfBasis] = useState(cur.pfBasis)
  const [daysBasis, setDaysBasis] = useState(cur.daysBasis)
  const [weekoffPaid, setWeekoffPaid] = useState(cur.payWeekoffForDaily)
  const [round, setRound] = useState(cur.roundNet)
  const [needGeo, setNeedGeo] = useState(cur.requireGeoNote)
  const [off, setOff] = useState(cur.weeklyOffDefault)
  const [pt, setPt] = useState<SlabRow[]>(toRows(cur.ptSlabs, 'amount'))
  const [tds, setTds] = useState<SlabRow[]>(toRows(cur.tdsSlabs, 'ratePct'))
  const set = (k: keyof typeof s) => (v: string) => setS((x) => ({ ...x, [k]: v }))

  if (!can) return <Denied title="Payroll settings" who="Payroll settings are for the owner and managers with payroll access." />

  function save() {
    const n = (k: keyof typeof s) => Number(s[k])
    const patch: Partial<HrSettings> = {
      pfEmployeePct: n('pfEmployeePct'), pfEmployerPct: n('pfEmployerPct'), pfWageCeiling: n('pfWageCeiling'), pfCap, pfBasis, esiEmployeePct: n('esiEmployeePct'), esiEmployerPct: n('esiEmployerPct'), esiWageCeiling: n('esiWageCeiling'),
      ptSlabs: fromRows(pt).map((r) => ({ upTo: r.upTo, amount: r.v })), tdsSlabs: fromRows(tds).map((r) => ({ upTo: r.upTo, ratePct: r.v })), tdsStandardDeduction: n('tdsStandardDeduction'), tdsRebateLimit: n('tdsRebateLimit'), tdsCessPct: n('tdsCessPct'),
      daysBasis, payWeekoffForDaily: weekoffPaid, overtimeMultiplier: n('overtimeMultiplier'), overtimeMinMins: n('overtimeMinMins'), workDayMins: n('workDayMins'), roundNet: round,
      leaveYearStartMonth: n('leaveYearStartMonth'), weeklyOffDefault: off, geoNote: s.geoNote, requireGeoNote: needGeo, payDay: n('payDay'),
    }
    if (act((st, ctx) => saveHrSettings(st, patch, ctx), 'Settings saved')) router.back()
  }
  function reset() {
    const d = DEFAULT_HR_SETTINGS
    setS({ pfEmployeePct: String(d.pfEmployeePct), pfEmployerPct: String(d.pfEmployerPct), pfWageCeiling: String(d.pfWageCeiling), esiEmployeePct: String(d.esiEmployeePct), esiEmployerPct: String(d.esiEmployerPct), esiWageCeiling: String(d.esiWageCeiling), tdsStandardDeduction: String(d.tdsStandardDeduction), tdsRebateLimit: String(d.tdsRebateLimit), tdsCessPct: String(d.tdsCessPct), overtimeMultiplier: String(d.overtimeMultiplier), overtimeMinMins: String(d.overtimeMinMins), workDayMins: String(d.workDayMins), leaveYearStartMonth: String(d.leaveYearStartMonth), payDay: String(d.payDay), geoNote: d.geoNote })
    setPfCap(d.pfCap); setPfBasis(d.pfBasis); setDaysBasis(d.daysBasis); setWeekoffPaid(d.payWeekoffForDaily); setRound(d.roundNet); setNeedGeo(d.requireGeoNote); setOff(d.weeklyOffDefault)
    setPt(toRows(d.ptSlabs, 'amount')); setTds(toRows(d.tdsSlabs, 'ratePct'))
  }
  const slabEditor = (title: string, rows: SlabRow[], setRows: (r: SlabRow[]) => void, vLabel: string) => (
    <Section title={title} style={{ marginTop: 6 }} action="Add slab" onAction={() => setRows([...rows.filter((r) => r.upTo !== ''), { upTo: String((Number(rows.filter((r) => r.upTo !== '').pop()?.upTo) || 0) + 1000), v: '0' }, ...rows.filter((r) => r.upTo === '')])}>
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
    <Screen title="Payroll settings" back footer={<Button label="Save" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Notice tone="warning" title="Defaults, not advice" body={RATES_NOTE} />
        <Section title="Provident fund" style={{ marginTop: 0 }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <NumberField containerStyle={{ flex: 1 }} label="Employee %" value={s.pfEmployeePct} onChange={set('pfEmployeePct')} decimals />
              <NumberField containerStyle={{ flex: 1 }} label="Employer %" value={s.pfEmployerPct} onChange={set('pfEmployerPct')} decimals />
            </View>
            <NumberField label="Wage ceiling per month" value={s.pfWageCeiling} onChange={set('pfWageCeiling')} />
            <Card padded={false}><SwitchRow title="Stop at the ceiling" subtitle="Off to work PF on the full wage" value={pfCap} onChange={setPfCap} /></Card>
            <Segmented value={pfBasis} options={[{ value: 'basic', label: 'On basic' }, { value: 'basic+allowances', label: 'Basic + allowances' }]} onChange={setPfBasis} />
          </View>
        </Section>
        <Section title="ESI" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <NumberField containerStyle={{ flex: 1 }} label="Employee %" value={s.esiEmployeePct} onChange={set('esiEmployeePct')} decimals />
              <NumberField containerStyle={{ flex: 1 }} label="Employer %" value={s.esiEmployerPct} onChange={set('esiEmployerPct')} decimals />
            </View>
            <NumberField label="Applies up to a wage of" value={s.esiWageCeiling} onChange={set('esiWageCeiling')} />
          </View>
        </Section>
        {slabEditor('Professional tax (monthly, by gross pay)', pt, setPt, 'Tax ₹')}
        <Section title="TDS estimate (yearly income)" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <NumberField label="Standard deduction" value={s.tdsStandardDeduction} onChange={set('tdsStandardDeduction')} />
            <NumberField label="No tax up to taxable income of" value={s.tdsRebateLimit} onChange={set('tdsRebateLimit')} />
            <NumberField label="Cess %" value={s.tdsCessPct} onChange={set('tdsCessPct')} decimals />
          </View>
        </Section>
        {slabEditor('Income tax slabs', tds, setTds, 'Rate %')}
        <Section title="How pay is worked out" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <Segmented value={daysBasis} options={[{ value: 'calendar', label: 'Calendar days' }, { value: 'fixed30', label: 'Always 30 days' }]} onChange={setDaysBasis} />
            <Card padded={false}>
              <SwitchRow title="Pay weekly off to daily-wage staff" value={weekoffPaid} onChange={setWeekoffPaid} />
              <SwitchRow title="Round net pay to the rupee" value={round} onChange={setRound} />
            </Card>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <NumberField containerStyle={{ flex: 1 }} label="Overtime rate ×" value={s.overtimeMultiplier} onChange={set('overtimeMultiplier')} decimals />
              <NumberField containerStyle={{ flex: 1 }} label="Ignore overtime under (min)" value={s.overtimeMinMins} onChange={set('overtimeMinMins')} />
            </View>
            <NumberField label="Minutes in a normal working day" value={s.workDayMins} onChange={set('workDayMins')} />
            <NumberField label="Salary day of the month (1–28)" value={s.payDay} onChange={set('payDay')} hint="Home reminds you if last month’s payroll is not run by then" />
          </View>
        </Section>
        <Section title="Leave and attendance" style={{ marginTop: 6 }}>
          <View style={{ gap: 14 }}>
            <NumberField label="Leave year starts in month (1 = January, 4 = April)" value={s.leaveYearStartMonth} onChange={set('leaveYearStartMonth')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {WEEKDAYS.map((d, i) => <Chip key={d} label={d} selected={off.includes(i)} onPress={() => setOff((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} />)}
            </View>
            <T v="caption" tone="mute">The weekly off given to new employees.</T>
            <Field label="Punch-in hint (optional)" value={s.geoNote} onChangeText={set('geoNote')} placeholder="Within 100 m of the shop" />
            <Card padded={false}><SwitchRow title="Ask where staff are when they punch" subtitle="A note in words — no location permission needed" value={needGeo} onChange={setNeedGeo} /></Card>
          </View>
        </Section>
        <Button label="Reset to the defaults" kind="outline" block onPress={reset} />
      </View>
    </Screen>
  )
}
