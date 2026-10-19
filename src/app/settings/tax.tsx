import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { computeLineTax, type TaxSlab } from '@/domain/tax'
import { useStore } from '@/data/hooks'
import { saveSettings, SettingsLocked, useCanSettings } from '@/features/settingsKit'
import { Button, IconButton } from '@/ui/Button'
import { MoneyField, NumberField, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Row } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { goBack } from '@/ui/nav'

interface Tier { upto: string; rate: string }
const MAX_TIERS = 5
const TOP = Number.MAX_SAFE_INTEGER

/** GST: whether shelf prices already include tax, and the rate that applies at each price level. */
export default function TaxSettings() {
  const { c } = useTheme()
  const router = useRouter()
  const allowed = useCanSettings()
  const store = useStore()

  const sorted = useMemo(() => [...store.slabs].sort((a, b) => a.upto - b.upto), [store.slabs])
  const [inclusive, setInclusive] = useState(store.priceIncludesTax)
  const [tiers, setTiers] = useState<Tier[]>(() => sorted.slice(0, -1).map((s) => ({ upto: String(s.upto), rate: String(s.rate) })))
  const [topRate, setTopRate] = useState(() => String(sorted[sorted.length - 1]?.rate ?? 18))
  const [sample, setSample] = useState('1000')
  const [tried, setTried] = useState(false)

  if (!allowed) return <SettingsLocked title="Tax & GST" />

  const slabs: TaxSlab[] = [...tiers.map((t) => ({ upto: Number(t.upto), rate: Number(t.rate) })), { upto: TOP, rate: Number(topRate) }]
  const rowErrors = tiers.map((t, i) => {
    const upto = Number(t.upto)
    if (!t.upto || !(upto > 0)) return 'Enter the price limit'
    if (i > 0 && upto <= Number(tiers[i - 1].upto)) return 'Must be higher than the one above'
    if (t.rate === '' || Number(t.rate) > 100) return 'Rate must be 0–100'
    return null
  })
  const topError = topRate === '' || Number(topRate) > 100 ? 'Rate must be 0–100' : null
  const bad = rowErrors.some(Boolean) || !!topError
  const dirty = inclusive !== store.priceIncludesTax || JSON.stringify(slabs) !== JSON.stringify(sorted)

  const price = Number(sample) || 0
  const demo = price > 0 ? computeLineTax(price, 1, slabs, inclusive) : null

  const update = (i: number, patch: Partial<Tier>) => setTiers((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)))
  const add = () => setTiers((ts) => {
    const last = ts.length ? Number(ts[ts.length - 1].upto) : 0
    return [...ts, { upto: String(last > 0 ? last * 2 : 1000), rate: topRate }]
  })

  function save() {
    setTried(true)
    if (bad) return
    if (saveSettings({ priceIncludesTax: inclusive, slabs })) goBack(router)
  }

  return (
    <Screen title="Tax & GST" back footer={<Button label="Save changes" size="lg" block disabled={!dirty} onPress={save} />}>
      <View style={{ paddingBottom: 12 }}>
        <Section title="Prices" style={{ marginTop: 6 }}>
          <Card padded={false}>
            <SwitchRow title="Prices include GST" subtitle={inclusive ? 'The price on the tag is what the customer pays. GST is worked out from it.' : 'Prices are before GST. GST is added on top at billing.'} value={inclusive} onChange={setInclusive} />
          </Card>
        </Section>

        <Section title="GST by price" style={{ marginTop: 24 }}>
          <Card>
            <T v="caption" tone="soft" style={{ marginBottom: 14 }}>The rate is picked from the price of one piece after discount. Items or categories with their own GST rate ignore these.</T>
            <View style={{ gap: 14 }}>
              {tiers.map((t, i) => (
                <Row key={i} gap={10} align="flex-start">
                  <View style={{ flex: 1.4 }}><MoneyField label={i === 0 ? 'Up to' : 'Above previous, up to'} value={t.upto} onChange={(v) => update(i, { upto: v })} error={tried ? rowErrors[i] : null} /></View>
                  <View style={{ flex: 1 }}><NumberField label="GST %" value={t.rate} onChange={(v) => update(i, { rate: v })} decimals suffix="%" /></View>
                  <View style={{ paddingTop: 24 }}><IconButton label="Remove this slab" tone="ghost" size={40} onPress={() => setTiers((ts) => ts.filter((_, j) => j !== i))}><Trash size={18} color={c.danger} /></IconButton></View>
                </Row>
              ))}
              <Row gap={10} align="flex-start">
                <View style={{ flex: 1.4, minHeight: 50, justifyContent: 'center', paddingTop: 18 }}>
                  <T v="bodyStrong" tone="soft">{tiers.length ? `Above ${inr(Number(tiers[tiers.length - 1].upto) || 0, 0)}` : 'All prices'}</T>
                </View>
                <View style={{ flex: 1 }}><NumberField label="GST %" value={topRate} onChange={setTopRate} decimals suffix="%" error={tried ? topError : null} /></View>
                <View style={{ width: 40 }} />
              </Row>
            </View>
            {tiers.length < MAX_TIERS ? <View style={{ marginTop: 16 }}><Button label="Add a price level" kind="soft" size="sm" icon={<Plus size={16} color={c.primary} />} onPress={add} /></View> : null}
          </Card>
        </Section>

        <Section title="Try it" style={{ marginTop: 24 }}>
          <Card>
            <MoneyField label="Price of one piece" value={sample} onChange={setSample} />
            {demo ? (
              <View style={{ marginTop: 12 }}>
                <KV k="GST rate" v={`${demo.rate}%`} strong />
                <KV k="Before GST" v={inr(demo.taxable)} />
                <KV k="CGST + SGST" v={inr(demo.tax)} sub={`${inr(demo.cgst)} + ${inr(demo.sgst)}`} />
                <KV k="Customer pays" v={inr(demo.gross)} strong />
              </View>
            ) : null}
          </Card>
        </Section>
        <View style={{ marginTop: 18 }}>
          <Notice tone="warning" title="Confirm rates with your accountant" body="GST rules change. The defaults are a starting point for the industry you chose, not tax advice." />
        </View>
      </View>
    </Screen>
  )
}
