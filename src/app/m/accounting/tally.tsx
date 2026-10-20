import React, { useState } from 'react'
import { View } from 'react-native'
import { useStore } from '@/data/hooks'
import { useApp, useCan } from '@/data/store'
import { fmtDate } from '@/domain/dates'
import { shareFile } from '@/features/shareFile'
import { tallyMastersXml, tallyVouchersCsv, tallyVouchersXml } from '@/modules/accounting/tally'
import { PeriodBar } from '@/modules/accounting/ui/PeriodBar'
import { usePeriod } from '@/modules/accounting/ui/hooks'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, FileText } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Tally Prime import files: ledgers first, then the period's vouchers. Plain accounting only — see the note on the screen. */
export default function TallyExport() {
  const { c } = useTheme()
  const can = useCan('accounting')
  const data = useApp((s) => s.data)
  const store = useStore()
  const p = usePeriod('fy')
  const [company, setCompany] = useState(store?.name ?? '')
  if (!can) return <Screen title="Tally export" back><T tone="mute">The books are for the owner and managers.</T></Screen>
  const co = company.trim()
  const need = () => { if (!co) { toast('Type the company name exactly as it is in Tally.', 'err'); return false } return true }
  const stamp = `${fmtDate(p.from)}-${fmtDate(p.to)}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return (
    <Screen title="Tally export" subtitle="Ledgers and vouchers for Tally Prime" back>
      <View style={{ gap: 14, paddingBottom: 24 }}>
        <Field label="Company name in Tally" value={company} onChangeText={setCompany} hint="It must match the company you open in Tally." />
        <PeriodBar p={p} />
        <Card style={{ gap: 10 }}>
          <T v="bodyStrong">1. Ledgers</T>
          <T v="caption" tone="mute">Import these first. They create the accounts, customers and suppliers.</T>
          <Button label="Ledgers (XML)" kind="outline" block icon={<Download size={18} color={c.ink} />} onPress={() => { if (need()) void shareFile('tally-ledgers.xml', tallyMastersXml(data, co).xml, 'text/xml') }} />
        </Card>
        <Card style={{ gap: 10 }}>
          <T v="bodyStrong">2. Vouchers</T>
          <T v="caption" tone="mute">Sales, credit notes, purchases, expenses, receipts, payments and journals for {fmtDate(p.from)} – {fmtDate(p.to)}.</T>
          <Button label="Vouchers (XML)" block icon={<Download size={18} color={c.onPrimary} />} onPress={() => { if (need()) { const r = tallyVouchersXml(data, { company: co, from: p.from, to: p.to }); if (!r.vouchers) return toast('No vouchers in this period.', 'err'); void shareFile(`tally-vouchers-${stamp}.xml`, r.xml, 'text/xml') } }} />
          <Button label="Vouchers (CSV)" kind="outline" block icon={<FileText size={18} color={c.ink} />} onPress={() => { const r = tallyVouchersCsv(data, { from: p.from, to: p.to }); if (!r.vouchers) return toast('No vouchers in this period.', 'err'); void shareFile(`vouchers-${stamp}.csv`, r.csv) }} />
        </Card>
        <Notice tone="warning" title="What this file does not carry" body="Accounting entries only. There are no stock items or quantities, and no GST register detail (HSN, GSTIN, place of supply), so GST returns from Tally need those entered there. Check opening balances against Tally before importing." />
      </View>
    </Screen>
  )
}
