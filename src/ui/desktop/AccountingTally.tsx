import React from 'react'
import { View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, FileText } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import type { PeriodState } from '@/modules/accounting/ui/hooks'
import { PeriodBar } from '@/modules/accounting/ui/PeriodBar'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopTallyExportProps {
  company: string
  setCompany: (v: string) => void
  period: PeriodState
  onLedgers: () => void
  onVouchersXml: () => void
  onVouchersCsv: () => void
}

/**
 * The desktop Tally-export screen: a form, not a grid (one company-name field, a period and three export buttons) —
 * so it uses the same centred-column settings shell as `DesktopStoreSettings`, with the exact mobile `Field`/`Card`/
 * `Button`/`Notice`/`PeriodBar` pieces `src/app/m/accounting/tally.tsx` already builds its export calls from.
 */
export function DesktopTallyExport({ company, setCompany, period, onLedgers, onVouchersXml, onVouchersCsv }: DesktopTallyExportProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Tally export" subtitle="Ledgers and vouchers for Tally Prime">
      <View style={{ gap: 14 }}>
        <Field label="Company name in Tally" value={company} onChangeText={setCompany} hint="It must match the company you open in Tally." />
        <PeriodBar p={period} />
        <Card style={{ gap: 10 }}>
          <T v="bodyStrong">1. Ledgers</T>
          <T v="caption" tone="mute">Import these first. They create the accounts, customers and suppliers.</T>
          <Button label="Ledgers (XML)" kind="outline" block icon={<Download size={18} color={c.ink} />} onPress={onLedgers} />
        </Card>
        <Card style={{ gap: 10 }}>
          <T v="bodyStrong">2. Vouchers</T>
          <T v="caption" tone="mute">Sales, credit notes, purchases, expenses, receipts, payments and journals for {fmtDate(period.from)} – {fmtDate(period.to)}.</T>
          <Button label="Vouchers (XML)" block icon={<Download size={18} color={c.onPrimary} />} onPress={onVouchersXml} />
          <Button label="Vouchers (CSV)" kind="outline" block icon={<FileText size={18} color={c.ink} />} onPress={onVouchersCsv} />
        </Card>
        <Notice tone="warning" title="What this file does not carry" body="Accounting entries only. There are no stock items or quantities, and no GST register detail (HSN, GSTIN, place of supply), so GST returns from Tally need those entered there. Check opening balances against Tally before importing." />
      </View>
    </DesktopSettingsPage>
  )
}
