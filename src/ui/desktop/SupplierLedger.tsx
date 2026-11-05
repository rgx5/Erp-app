import React from 'react'
import { Linking, View } from 'react-native'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { Supplier } from '@/domain/types'
import type { PayableDoc, Statement } from '@/modules/purchasing/payables'
import type { SupplierPayment } from '@/modules/purchasing/types'
import { Button } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Download, MessageCircle, Pencil, Share as ShareIcon } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, SplitPane, Toolbar, cellNum, cellText, type Column } from './kit'

type LedgerRow = { id: string; label: string; sub?: string; added: number; reduced: number; balance: number }

export interface DesktopSupplierLedgerProps {
  supplier: Supplier
  net: number
  open: PayableDoc[]
  payments: SupplierPayment[]
  cancelled: Set<string>
  statement: Statement
  creditDays: number
  termsNote: string | undefined
  editing: boolean
  setEditing: (v: boolean) => void
  days: string
  setDays: (v: string) => void
  notes: string
  setNotes: (v: string) => void
  onOpenEditor: () => void
  onSaveTerms: () => void
  onCancelPayment: (id: string, no: string) => void
  onAdvice: (p: SupplierPayment) => void
  onPay: () => void
  onExportCsv: () => void
  onShare: () => void
}

/**
 * The desktop supplier-ledger screen: a toolbar with the actions the phone scatters across header and card
 * (call, change terms, pay), a KPI strip, a dense grid of the 90-day ledger, and a side panel for bills to pay and
 * payments made. The statement, open bills and payments all come from `src/app/m/purchasing/payables/supplier/
 * [id].tsx` exactly as the phone screen computes them (`supplierStatement`, `paymentsList`).
 */
export function DesktopSupplierLedger({ supplier, net, open, payments, cancelled, statement, creditDays, termsNote, editing, setEditing, days, setDays, notes, setNotes, onOpenEditor, onSaveTerms, onCancelPayment, onAdvice, onPay, onExportCsv, onShare }: DesktopSupplierLedgerProps) {
  const { c } = useTheme()
  const now = Date.now()

  const rows: LedgerRow[] = [
    { id: 'opening', label: 'Opening balance', added: 0, reduced: 0, balance: statement.opening },
    ...statement.entries.map((e, i) => ({ id: `${e.docId}${i}`, label: e.ref, sub: `${fmtDayShort(e.date)} · ${e.memo}`, added: e.added, reduced: e.reduced, balance: e.balance })),
    { id: 'closing', label: 'Closing balance', added: 0, reduced: 0, balance: statement.closing },
  ]

  const columns: Array<Column<LedgerRow>> = [
    { key: 'label', label: 'Entry', render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.label}</T>
        {r.sub ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sub}</T> : null}
      </View>
    ) },
    { key: 'change', label: 'Change', width: 120, align: 'right', render: (r) => (r.added ? cellNum(`+${inr(r.added, 0)}`) : r.reduced ? <T style={[dtext.num, { color: c.inkMute }]}>−{inr(r.reduced, 0)}</T> : null) },
    { key: 'balance', label: 'Balance', width: 130, align: 'right', render: (r) => cellNum(inr(r.balance, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={supplier.name}
          subtitle="Supplier ledger"
          right={
            <>
              {supplier.phone ? <DeskButton label="Call" onPress={() => void Linking.openURL(`tel:${supplier.phone}`)} /> : null}
              <DeskButton label="Change terms" icon={<Pencil size={14} color={c.ink} />} onPress={onOpenEditor} />
              <DeskButton label={net > 0 ? `Pay ${supplier.name.split(' ')[0]}` : 'Make a payment'} tone="primary" onPress={onPay} />
            </>
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label={net < 0 ? 'Paid in advance' : 'You owe'} value={inr(Math.abs(net), 0)} tone={net < 0 ? 'success' : net > 0 ? 'warning' : 'default'} delta={`${open.length} open ${open.length === 1 ? 'bill' : 'bills'}`} />
        <KpiTile label="Days to pay" value={String(creditDays)} tone="primary" delta={termsNote ?? 'Credit terms'} />
      </KpiStrip>

      <SplitPane widths={['flex', 340]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <View style={{ padding: 14, paddingBottom: 6, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T style={[dtext.label, { color: c.inkMute }]}>Ledger · last 90 days</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <DeskButton label="CSV" icon={<Download size={13} color={c.ink} />} onPress={onExportCsv} />
              <DeskButton label="Share" icon={<ShareIcon size={13} color={c.ink} />} onPress={onShare} />
            </View>
          </View>
          <DataTable rows={rows} columns={columns} emptyLabel="No activity in the last 90 days" />
        </View>

        <View style={{ flex: 1, margin: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <View style={{ padding: 14, paddingBottom: 6 }}><T style={[dtext.label, { color: c.inkMute }]}>Bills to pay · {open.length}</T></View>
            {open.length ? open.map((d, i) => (
              <View key={d.ref} style={{ flexDirection: 'row', gap: 8, padding: 14, paddingTop: i ? 10 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                <View style={{ flex: 1 }}>
                  <T style={dtext.cellStrong} numberOfLines={1}>{d.no}</T>
                  <T style={[dtext.tiny, { color: c.inkMute }]}>{d.dueDate ? `Due ${fmtDayShort(d.dueDate)}` : 'Opening balance'}</T>
                </View>
                {d.dueDate && d.dueDate < now ? <Pill tone="danger" label="Overdue" /> : null}
                <View style={{ alignItems: 'flex-end' }}>
                  <T style={dtext.num}>{inr(d.outstanding, 0)}</T>
                  {d.outstanding < d.amount ? <T style={[dtext.tiny, { color: c.inkMute }]}>of {inr(d.amount, 0)}</T> : null}
                </View>
              </View>
            )) : <View style={{ padding: 14 }}><T tone="mute">Nothing unpaid.</T></View>}
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <View style={{ padding: 14, paddingBottom: 6 }}><T style={[dtext.label, { color: c.inkMute }]}>Payments · {payments.length}</T></View>
            {payments.length ? payments.slice(0, 15).map((pmt, i) => {
              const gone = cancelled.has(pmt.id)
              return (
                <View key={pmt.id} style={{ padding: 14, paddingTop: i ? 10 : 0, gap: 6, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <T style={dtext.cellStrong} numberOfLines={1}>{pmt.no} · {pmt.mode}</T>
                      <T style={[dtext.tiny, { color: c.inkMute }]}>{fmtDayShort(pmt.date)}{pmt.ref ? ` · ${pmt.ref}` : ''}</T>
                    </View>
                    <T style={dtext.num}>{inr(pmt.amount, 0)}</T>
                  </View>
                  {gone ? <Badge tone="danger">Cancelled</Badge> : (
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <DeskButton label="Advice" icon={<MessageCircle size={13} color={c.primary} />} onPress={() => onAdvice(pmt)} />
                      <DeskButton label="Cancel" onPress={() => onCancelPayment(pmt.id, pmt.no)} />
                    </View>
                  )}
                </View>
              )
            }) : <View style={{ padding: 14 }}><T tone="mute">No payments yet.</T></View>}
          </View>
        </View>
      </SplitPane>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Payment terms" subtitle={supplier.name} footer={<Button label="Save" size="lg" block onPress={onSaveTerms} />}>
        <View style={{ gap: 14 }}>
          <NumberField label="Days to pay" value={days} onChange={setDays} hint="How long after the goods arrive the bill is due" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </View>
      </Sheet>
    </DeskPage>
  )
}
