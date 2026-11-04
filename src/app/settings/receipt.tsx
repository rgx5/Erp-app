import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { billPrintHtml, receiptOptions } from '@/domain/receipt'
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
import { goBack } from '@/ui/nav'
import { useBreakpoint } from '@/ui/layout'
import { DesktopReceiptSettings } from '@/ui/desktop/SettingsScreens'

/** How the printed or shared receipt looks: paper width, wording, and which extra lines it carries. */
export default function ReceiptSettings() {
  const { c } = useTheme()
  const router = useRouter()
  const { isDesktop } = useBreakpoint()
  const allowed = useCanSettings()
  const store = useStore()
  const base = receiptOptions(store)

  const [format, setFormat] = useState<'thermal' | 'a4'>(store.printFormat)
  const [width, setWidth] = useState<'58mm' | '80mm'>(store.receiptWidth)
  const [autoPrint, setAutoPrint] = useState(store.autoPrintOnSale)
  const [policy, setPolicy] = useState(store.returnPolicy)
  const [windowDays, setWindowDays] = useState(String(store.returnWindowDays ?? 0))
  const [footer, setFooter] = useState(store.footerNote)
  const [showTax, setShowTax] = useState(base.showTax)
  const [showHsn, setShowHsn] = useState(base.showHsn)
  const [showSavings, setShowSavings] = useState(base.showSavings)
  const [showLoyalty, setShowLoyalty] = useState(base.showLoyalty)

  const draft: StoreSettings = useMemo(() => ({
    ...store, printFormat: format, receiptWidth: width, autoPrintOnSale: autoPrint, returnPolicy: policy, footerNote: footer, receiptShowTax: showTax, receiptShowHsn: showHsn, receiptShowSavings: showSavings, receiptShowLoyalty: showLoyalty,
  }), [store, format, width, autoPrint, policy, footer, showTax, showHsn, showSavings, showLoyalty])
  const opts = { showTax, showHsn, showSavings, showLoyalty }

  if (!allowed) return <SettingsLocked title="Receipts" />

  const days = Math.max(0, Number(windowDays) || 0)
  const dirty = format !== store.printFormat || width !== store.receiptWidth || autoPrint !== store.autoPrintOnSale || policy !== store.returnPolicy || footer !== store.footerNote || days !== (store.returnWindowDays ?? 0)
    || showTax !== base.showTax || showHsn !== base.showHsn || showSavings !== base.showSavings || showLoyalty !== base.showLoyalty

  function save() {
    const ok = saveSettings({ printFormat: format, receiptWidth: width, autoPrintOnSale: autoPrint, returnPolicy: policy.trim(), footerNote: footer.trim(), returnWindowDays: days, receiptShowTax: showTax, receiptShowHsn: showHsn, receiptShowSavings: showSavings, receiptShowLoyalty: showLoyalty })
    if (ok) goBack(router)
  }
  const testPrint = () => void printHtml(billPrintHtml({ bill: sampleBill(draft), store: draft }, opts))

  if (isDesktop) {
    return (
      <DesktopReceiptSettings
        format={format} setFormat={setFormat} width={width} setWidth={setWidth} autoPrint={autoPrint} setAutoPrint={setAutoPrint}
        policy={policy} setPolicy={setPolicy} windowDays={windowDays} setWindowDays={setWindowDays} footer={footer} setFooter={setFooter}
        showTax={showTax} setShowTax={setShowTax} showHsn={showHsn} setShowHsn={setShowHsn} showSavings={showSavings} setShowSavings={setShowSavings}
        showLoyalty={showLoyalty} setShowLoyalty={setShowLoyalty} draft={draft} opts={opts} dirty={dirty} onSave={save} onTestPrint={testPrint}
      />
    )
  }

  return (
    <Screen title="Receipts" back footer={<Button label="Save changes" size="lg" block disabled={!dirty} onPress={save} />}>
      <View style={{ paddingBottom: 12 }}>
        <Section title="What prints" style={{ marginTop: 6 }}>
          <Segmented<'thermal' | 'a4'> value={format} onChange={setFormat} options={[{ value: 'thermal', label: 'Thermal receipt' }, { value: 'a4', label: 'A4 tax invoice' }]} />
          <T v="caption" tone="mute" style={{ marginTop: 8 }}>What every one-tap &ldquo;Print&rdquo; sends — at the till, on a saved bill, and (if turned on below) the moment a sale is charged. Either one can also be sent as a PDF invoice from a bill&apos;s own page.</T>
        </Section>

        {format === 'thermal' ? (
          <Section title="Paper width" style={{ marginTop: 24 }}>
            <Segmented<'58mm' | '80mm'> value={width} onChange={setWidth} options={[{ value: '58mm', label: '58 mm (small)' }, { value: '80mm', label: '80 mm (standard)' }]} />
          </Section>
        ) : null}

        <Section title="Preview" style={{ marginTop: 24 }}>
          {format === 'thermal' ? (
            <View style={{ backgroundColor: c.sunken, borderRadius: 20, padding: 16 }}>
              <ReceiptPreview store={draft} opts={opts} />
            </View>
          ) : (
            <Card><T tone="mute">A4 invoices are formatted for full-page printing — the itemised GST tax invoice, with HSN summary, buyer details and an authorised-signatory line. Print a sample to see it.</T></Card>
          )}
          <View style={{ marginTop: 12 }}>
            <Button label={format === 'thermal' ? 'Print a test receipt' : 'Print a sample A4 invoice'} kind="outline" block icon={<Printer size={18} color={c.ink} />} onPress={testPrint} />
          </View>
        </Section>

        <Section title="At the till" style={{ marginTop: 24 }}>
          <Card padded={false}>
            <SwitchRow title="Print automatically" subtitle="The moment a sale is charged — no extra tap" value={autoPrint} onChange={setAutoPrint} />
          </Card>
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
