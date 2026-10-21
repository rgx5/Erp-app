import React, { useMemo, useState } from 'react'
import { Linking, Share, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { DAY, fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { whatsApp } from '@/features/share'
import { creditDaysFor, payables, paymentsList, supplierStatement } from '@/modules/purchasing/payables'
import { reversedIds } from '@/modules/purchasing/reversal'
import { reversePayment, saveSupplierTerms } from '@/modules/purchasing/ops-payables'
import { paymentAdviceText, statementCsv, statementText } from '@/modules/purchasing/reports'
import { Button } from '@/ui/Button'
import { Field, NumberField } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, MessageCircle, Pencil, Share as ShareIcon } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One supplier's account: what is owed and by when, their terms, payments made, and the ledger. */
export default function SupplierLedger() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const supplier = data.suppliers[id]
  const now = Date.now()
  const [editing, setEditing] = useState(false)
  const [days, setDays] = useState('')
  const [notes, setNotes] = useState('')

  const dues = useMemo(() => payables(data).bySupplier[id], [data, id])
  const statement = useMemo(() => supplierStatement(data, id, now - 90 * DAY, now), [data, id, now])
  const payments = useMemo(() => paymentsList(data, id), [data, id])
  const cancelled = useMemo(() => reversedIds(Object.values(data.supplierPayments)), [data.supplierPayments])

  if (!can) return <Screen title="Supplier ledger" back><T tone="mute">Payables are for the owner and managers.</T></Screen>
  if (!supplier) return <Screen title="Not found" back><T tone="mute">This supplier is no longer here.</T></Screen>

  const net = dues?.net ?? 0
  const open = (dues?.docs ?? []).filter((d) => d.outstanding > 0).sort((a, b) => (a.dueDate ?? Infinity) - (b.dueDate ?? Infinity))
  const terms = data.supplierTerms?.[id]
  function openEditor() { setDays(String(terms?.creditDays ?? creditDaysFor(data, id))); setNotes(terms?.notes ?? ''); setEditing(true) }
  function saveTerms() {
    try { perform((s, ctx) => saveSupplierTerms(s, id, { creditDays: Number(days), notes }, ctx)); toast('Terms saved', 'ok'); setEditing(false) }
    catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  async function cancel(paymentId: string, no: string) {
    if (!(await ask({ title: `Cancel ${no}?`, message: 'What it settled becomes owed again. Use this for a bounced cheque or a wrong entry.', confirm: 'Cancel payment', danger: true }))) return
    try { perform((s, ctx) => reversePayment(s, paymentId, '', ctx)); toast(`${no} cancelled`, 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not cancel', 'err') }
  }

  return (
    <Screen title={supplier.name} subtitle="Supplier ledger" back
      footer={<Button label={net > 0 ? `Pay ${supplier.name.split(' ')[0]}` : 'Make a payment'} size="lg" block onPress={() => router.push({ pathname: '/m/purchasing/payables/pay', params: { supplierId: id, ...(net > 0 ? { amount: String(net) } : {}) } })} />}>
      <View style={{ gap: 4, paddingBottom: 16 }}>
        <Card>
          <KV k={net < 0 ? 'Paid in advance' : 'You owe'} v={inr(Math.abs(net), 0)} strong big tone={net < 0 ? 'success' : undefined} />
          <KV k="Days to pay" v={String(creditDaysFor(data, id))} />
          {terms?.notes ? <T v="caption" tone="mute">{terms.notes}</T> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <Button label="Change terms" kind="soft" size="sm" icon={<Pencil size={15} color={c.primary} />} onPress={openEditor} />
            {supplier.phone ? <Button label="Call" kind="soft" size="sm" onPress={() => void Linking.openURL(`tel:${supplier.phone}`)} /> : null}
          </View>
        </Card>

        <Section title={`Bills to pay · ${open.length}`}>
          {open.length ? (
            <Card padded={false}>
              {open.map((d) => (
                <ListRow key={d.ref} title={d.no} subtitle={d.dueDate ? `Due ${fmtDayShort(d.dueDate)}` : 'Opening balance'} value={inr(d.outstanding, 0)} sub={d.outstanding < d.amount ? `of ${inr(d.amount, 0)}` : undefined}
                  badge={d.dueDate && d.dueDate < now ? <Badge tone="danger">Overdue</Badge> : undefined} />
              ))}
            </Card>
          ) : <T tone="mute">Nothing unpaid.</T>}
        </Section>

        <Section title={`Payments · ${payments.length}`}>
          {payments.length ? (
            <Card padded={false}>
              {payments.slice(0, 15).map((p) => {
                const gone = cancelled.has(p.id)
                return (
                  <ListRow key={p.id} title={`${p.no} · ${p.mode}`} subtitle={`${fmtDayShort(p.date)}${p.ref ? ` · ${p.ref}` : ''}`} value={inr(p.amount, 0)}
                    badge={gone ? <Badge tone="danger">Cancelled</Badge> : undefined}
                    right={gone ? undefined : (
                      <View style={{ flexDirection: 'row', gap: 4 }}>
                        <Button label="Advice" kind="ghost" size="sm" icon={<MessageCircle size={14} color={c.primary} />} onPress={() => void whatsApp(paymentAdviceText(data, p), supplier.phone)} />
                        <Button label="Cancel" kind="ghost" size="sm" onPress={() => void cancel(p.id, p.no)} />
                      </View>
                    )} />
                )
              })}
            </Card>
          ) : <T tone="mute">No payments yet.</T>}
        </Section>

        <Section title="Ledger · last 90 days" action="Share" onAction={() => void Share.share({ message: statementText(data, statement) })}>
          <Card padded={false}>
            <ListRow dense title="Opening balance" value={inr(statement.opening, 0)} />
            {statement.entries.map((e, i) => (
              <ListRow key={`${e.docId}${i}`} dense title={e.ref} subtitle={`${fmtDayShort(e.date)} · ${e.memo}`} value={e.added ? `+${inr(e.added, 0)}` : `−${inr(e.reduced, 0)}`} valueTone={e.added ? 'default' : 'success'} sub={`Balance ${inr(e.balance, 0)}`} />
            ))}
            <ListRow dense title="Closing balance" value={inr(statement.closing, 0)} />
          </Card>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Export CSV" kind="outline" size="sm" icon={<Download size={15} color={c.primary} />}
              onPress={() => void shareFile(csvFileName(`ledger ${supplier.name}`), statementCsv(data, statement)).catch(() => toast('Could not export', 'err'))} />
            <Button label="Share" kind="outline" size="sm" icon={<ShareIcon size={15} color={c.primary} />} onPress={() => void Share.share({ message: statementText(data, statement) })} />
          </View>
        </Section>
      </View>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Payment terms" subtitle={supplier.name} footer={<Button label="Save" size="lg" block onPress={saveTerms} />}>
        <View style={{ gap: 14 }}>
          <NumberField label="Days to pay" value={days} onChange={setDays} hint="How long after the goods arrive the bill is due" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </View>
      </Sheet>
    </Screen>
  )
}
