import React from 'react'
import { ScrollView, View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { Bill } from '@/domain/types'
import { DeskPage, DeskSegmented, Toolbar } from './kit'

export type B2BTab = 'einvoice' | 'eway'

/** The desktop shell for the GST-invoice detail: a toolbar and a tab switch, the content of each tab supplied by
 * `DesktopEInvoicePanel`/`DesktopEwayPanel` below — the exact tabs `m/pricing/b2b/[billId].tsx` already has. */
export function DesktopB2BBillPage({ bill, tab, setTab, children }: { bill: Bill; tab: B2BTab; setTab: (t: B2BTab) => void; children: React.ReactNode }) {
  return (
    <DeskPage
      toolbar={(
        <Toolbar title={bill.no} subtitle={`${fmtDate(bill.date)} · ${inr(Math.abs(bill.total))}`}
          right={<DeskSegmented<B2BTab> value={tab} onChange={setTab} options={[{ id: 'einvoice', label: 'E-invoice' }, { id: 'eway', label: 'E-way bill' }]} />} />
      )}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', paddingVertical: 24, paddingHorizontal: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ width: '100%', maxWidth: 760, paddingBottom: 24 }}>{children}</View>
      </ScrollView>
    </DeskPage>
  )
}
