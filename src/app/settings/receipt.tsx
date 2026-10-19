import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { receiptHtml, receiptOptions } from '@/domain/receipt'
import { sampleBill } from '@/domain/sampleBill'
import type { StoreSettings } from '@/domain/types'
import { useStore } from '@/data/hooks'
import { ReceiptPreview } from '@/features/ReceiptPreview'
import { saveSettings, SettingsLocked, useCanSettings } from '@/features/settingsKit'
import { printHtml } from '@/features/share'
import { Button } from '@/ui/Button'
import { Field, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Printer } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** How the printed or shared receipt looks: paper width, wording, and which extra lines it carries. */
export default function ReceiptSettings() {
  const { c } = useTheme()
  const router = useRouter()
  const allowed = useCanSettings()
  const store = useStore()
  const base = receiptOptions(store)

  const [width, setWidth] = useState<'58mm' | '80mm'>(store.receiptWidth)
  const [policy, setPolicy] = useState(store.returnPolicy)
  const [windowDays, setWindowDays] = useState(String(store.returnWindowDays ?? 0))
  const [footer, setFooter] = useState(store.footerNote)
  const [showTax, setShowTax] = useState(base.showTax)
  const [showHsn, setShowHsn] = useState(base.showHsn)
  const [showSavings, setShowSavings] = useState(base.showSavings)
  const [showLoyalty, setShowLoyalty] = useState(base.showLoyalty)

  const draft: StoreSettings = useMemo(() => ({
    ...store, receiptWidth: width, returnPolicy: policy, footerNote: footer, receiptShowTax: showTax, receiptShowHsn: showHsn, receiptShowSavings: showSavings, receiptShowLoyalty: showLoyalty,
  }), [store, width, policy, footer, showTax, showHsn, showSavings, showLoyalty])
  const opts = { showTax, showHsn, showSavings, showLoyalty }

  if (!allowed) return <SettingsLocked title="Receipts" />

  const days = Math.max(0, Number(windowDays) || 0)
  const dirty = width !== store.receiptWidth || policy !== store.returnPolicy || footer !== store.footerNote || days !== (store.returnWindowDays ?? 0)
    || showTax !== base.showTax || showHsn !== base.showHsn || showSavings !== base.showSavings || showLoyalty !== base.showLoyalty

  function save() {
    const ok = saveSettings({ receiptWidth: width, returnPolicy: policy.trim(), footerNote: footer.trim(), returnWindowDays: days, receiptShowTax: showTax, receiptShowHsn: showHsn, receiptShowSavings: showSavings, receiptShowLoyalty: showLoyalty })
    if (ok) router.back()
  }
  const testPrint = () => void printHtml(receiptHtml({ bill: sampleBill(draft), store: draft }, opts))

  return (
    <Screen title="Receipts" back footer={<Button label="Save changes" size="lg" block disabled={!dirty} onPress={save} />}>
      <View style={{ paddingBottom: 12 }}>
        <Section title="Preview" style={{ marginTop: 6 }}>
          <View style={{ backgroundColor: c.sunken, borderRadius: 20, padding: 16 }}>
            <ReceiptPreview store={draft} opts={opts} />
          </View>
          <View style={{ marginTop: 12 }}>
            <Button label="Print a test receipt" kind="outline" block icon={<Printer size={18} color={c.ink} />} onPress={testPrint} />
          </View>
        </Section>

        <Section title="Paper" style={{ marginTop: 24 }}>
          <Segmented<'58mm' | '80mm'> value={width} onChange={setWidth} options={[{ value: '58mm', label: '58 mm (small)' }, { value: '80mm', label: '80 mm (standard)' }]} />
        </Section>

        <Section title="Wording" style={{ marginTop: 24 }}>
          <View style={{ gap: 14 }}>
            <Field label="Return & exchange policy" value={policy} onChangeText={setPolicy} multiline hint="Printed at the bottom of every receipt" />
            <NumberField label="Returns accepted for (days)" value={windowDays} onChange={setWindowDays} hint="Later returns still work but are flagged. 0 means no limit." />
            <Field label="Thank-you note" value={footer} onChangeText={setFooter} />
          </View>
        </Section>

        <Section title="Extra lines" style={{ marginTop: 24 }}>
          <Card padded={false}>
            <SwitchRow title="Tax breakup" subtitle="Taxable value, CGST and SGST" value={showTax} onChange={setShowTax} />
            <SwitchRow title="HSN summary" subtitle="Needed on a GST tax invoice" value={showHsn} onChange={setShowHsn} />
            <SwitchRow title="“You saved” line" subtitle="Total MRP minus what the customer paid" value={showSavings} onChange={setShowSavings} />
            <SwitchRow title="Loyalty points earned" subtitle="Shown when the customer earns points" value={showLoyalty} onChange={setShowLoyalty} />
          </Card>
        </Section>
        <T v="caption" tone="mute" style={{ marginTop: 18 }}>The A4 tax invoice always shows the full tax breakup and HSN summary.</T>
      </View>
    </Screen>
  )
}
