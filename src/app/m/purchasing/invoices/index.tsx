import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { itcClosingSoon, itcRegister } from '@/modules/purchasing/itc'
import { reversePurchaseInvoice } from '@/modules/purchasing/ops-invoices'
import { itcCsv } from '@/modules/purchasing/reports'
import { reversedIds } from '@/modules/purchasing/reversal'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, KV, ListRow, Notice, Section } from '@/ui/blocks'
import { Download, ReceiptText } from '@/ui/icons'
import { T } from '@/ui/Text'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Supplier invoices and the GST input credit they carry: what can be claimed, what is blocked, and what is closing soon. */
export default function Invoices() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const reg = useMemo(() => itcRegister(data, 0, now + 86_400_000), [data, now])
  const soon = useMemo(() => itcClosingSoon(data, now, 30), [data, now])
  const all = Object.values(data.purchaseInvoices)
  const gone = reversedIds(all)
  const list = all.filter((i) => !i.reverses).sort((a, b) => b.invoiceDate - a.invoiceDate)
  if (!can) return <Screen title="Supplier invoices" back><T tone="mute">Supplier invoices are for the owner and managers.</T></Screen>

  async function cancel(id: string, no: string) {
    if (!(await ask({ title: `Cancel ${no}?`, message: 'Its input credit and anything it added to what you owe are taken back.', confirm: 'Cancel invoice', danger: true }))) return
    try { perform((s, ctx) => reversePurchaseInvoice(s, id, 'Cancelled', ctx)); toast('Invoice cancelled', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not cancel', 'err') }
  }

  return (
    <Screen title="Supplier invoices" subtitle="GST input credit" back
      right={list.length ? <Button label="CSV" kind="soft" size="sm" icon={<Download size={15} color={c.primary} />} onPress={() => void shareFile(csvFileName('input credit'), itcCsv(data, 0, now + 86_400_000)).catch(() => toast('Could not export', 'err'))} /> : undefined}
      footer={<Button label="Add supplier invoice" size="lg" block onPress={() => router.push('/m/purchasing/invoices/new')} />}>
      <View style={{ gap: 14, paddingBottom: 16 }}>
        <Card>
          <KV k="Credit to claim" v={inr(reg.eligible.total, 0)} tone="success" />
          <KV k="Given back on returns" v={inr(reg.reversed.total, 0)} />
          <KV k="Net credit" v={inr(reg.net.total, 0)} strong />
          <KV k="Tax with no credit" sub="Part of the cost" v={inr(reg.blocked.total, 0)} />
        </Card>
        {soon.length ? <Notice tone="warning" title={`${soon.length} ${soon.length === 1 ? 'invoice' : 'invoices'} closing for credit`} body="The time limit to claim credit ends within 30 days — include them in your next return." /> : null}
        {list.length ? (
          <Section title={`Invoices · ${list.length}`} style={{ marginTop: 0 }}>
            <Card padded={false}>
              {list.map((i) => {
                const cancelled = gone.has(i.id)
                return (
                  <View key={i.id}>
                    <ListRow title={`${i.invoiceNo} · ${data.suppliers[i.supplierId]?.name ?? 'Supplier'}`} subtitle={`${i.no} · ${fmtDayShort(i.invoiceDate)}${i.itc.eligible ? '' : ' · no credit'}`} value={inr(i.total, 0)}
                      badge={cancelled ? <Badge tone="danger">Cancelled</Badge> : i.itc.eligible ? <Badge tone="success">Credit</Badge> : <Badge tone="warning">Blocked</Badge>} />
                    {!cancelled ? <View style={{ paddingHorizontal: 14, paddingBottom: 10, alignItems: 'flex-start' }}><Button label="Cancel" kind="soft" size="sm" onPress={() => void cancel(i.id, i.no)} /></View> : null}
                  </View>
                )
              })}
            </Card>
          </Section>
        ) : <EmptyState icon={<ReceiptText size={26} color={c.primary} />} title="No supplier invoices" hint="Enter a supplier's tax invoice to track the GST credit you can claim." />}
      </View>
    </Screen>
  )
}
