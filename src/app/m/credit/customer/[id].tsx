import React, { useMemo, useState } from 'react'
import { Linking, Share, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { DAY, fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { OpError } from '@/data/ops'
import { perform, useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { creditStatus, customerStatement, receivables } from '@/modules/credit/logic'
import { saveCustomerTerms } from '@/modules/credit/ops'
import { buildReminder } from '@/modules/credit/reminders'
import { statementCsv, statementText } from '@/modules/credit/reports'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV, ListRow, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, MessageCircle, Pencil, QrCode, Send, Share as ShareIcon } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** One customer's credit account: what they owe and by when, their terms, a reminder, and the statement. */
export default function CustomerAccount() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('collections')
  const canTerms = useCan('credit')
  const data = useApp((s) => s.data)
  const customer = data.customers[id]
  const now = Date.now()
  const [editing, setEditing] = useState(false)
  const [days, setDays] = useState('')
  const [limit, setLimit] = useState('')
  const [blocked, setBlocked] = useState(false)
  const [notes, setNotes] = useState('')

  const rec = useMemo(() => receivables(data), [data])
  const st = useMemo(() => creditStatus(data, id, now, rec), [data, id, now, rec])
  const dues = rec.byCustomer[id]
  const open = (dues?.bills ?? []).filter((b) => b.outstanding > 0).sort((a, b) => a.dueDate - b.dueDate)
  const statement = useMemo(() => customerStatement(data, id, now - 90 * DAY, now), [data, id, now])
  const reminder = useMemo(() => buildReminder(data, id, now, {}, rec), [data, id, now, rec])

  if (!can) return <Screen title="Credit account" back><T tone="mute">Credit accounts are for the owner, managers and cashiers.</T></Screen>
  if (!customer) return <Screen title="Not found" back><T tone="mute">This customer is no longer here.</T></Screen>

  const terms = data.customerTerms?.[id]
  function openEditor() {
    setDays(String(terms?.creditDays ?? st.creditDays)); setLimit(terms?.creditLimit ? String(terms.creditLimit) : ''); setBlocked(!!terms?.blocked); setNotes(terms?.notes ?? '')
    setEditing(true)
  }
  function saveTerms() {
    try {
      perform((s, ctx) => saveCustomerTerms(s, id, { creditLimit: Number(limit) || 0, creditDays: Number(days), blocked, notes }, ctx))
      toast('Credit terms saved', 'ok'); setEditing(false)
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }
  const open_ = (url: string | null) => { if (url) Linking.openURL(url).catch(() => toast('Could not open the app', 'err')); else toast('This customer has no usable phone number', 'err') }

  return (
    <Screen title={customer.name} subtitle="Credit account" back
      footer={<Button label={st.owed > 0 ? `Collect from ${customer.name.split(' ')[0]}` : 'Receive a payment'} size="lg" block onPress={() => router.push({ pathname: '/m/credit/collect', params: { customerId: id, ...(st.owed > 0 ? { amount: String(st.owed) } : {}) } })} />}>
      <View style={{ gap: 4, paddingBottom: 16 }}>
        <Card>
          <KV k={st.owed < 0 ? 'Paid in advance' : 'Owes'} v={inr(Math.abs(st.owed), 0)} strong big tone={st.owed < 0 ? 'success' : undefined} />
          {st.overdue > 0 ? <KV k="Overdue" sub={`${st.oldestDaysOverdue} days late at most`} v={inr(st.overdue, 0)} tone="danger" /> : null}
          <KV k="Days to pay" v={String(st.creditDays)} />
          <KV k="Credit limit" v={st.limit > 0 ? inr(st.limit, 0) : 'None'} sub={st.available !== null ? `${inr(st.available, 0)} left` : undefined} />
          {st.blocked ? <Notice tone="danger" title="Not allowed to buy on account" /> : null}
          {canTerms ? <Button label="Change terms" kind="soft" size="sm" icon={<Pencil size={15} color={c.primary} />} onPress={openEditor} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}
        </Card>

        <Section title={`Unpaid bills · ${open.length}`}>
          {open.length ? (
            <Card padded={false}>
              {open.map((b) => (
                <ListRow key={b.billId} title={b.no} subtitle={`Sold ${fmtDayShort(b.date)} · due ${fmtDayShort(b.dueDate)}`} value={inr(b.outstanding, 0)} sub={b.outstanding < b.amount ? `of ${inr(b.amount, 0)}` : undefined}
                  badge={b.dueDate < now ? <Badge tone="danger">Overdue</Badge> : undefined} onPress={() => router.push({ pathname: '/m/credit/return/[billId]', params: { billId: b.billId } })} />
              ))}
            </Card>
          ) : <T tone="mute">Nothing unpaid.</T>}
          {open.length ? <T v="caption" tone="mute">Tap a bill to return goods from it — the amount owed comes down first.</T> : null}
        </Section>

        {reminder ? (
          <Section title="Remind">
            <Card>
              <T v="caption" tone="mute">{reminder.text}</T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color={c.onPrimary} />} onPress={() => open_(reminder.whatsapp)} />
                <Button label="SMS" kind="soft" size="sm" icon={<Send size={15} color={c.primary} />} onPress={() => open_(reminder.sms)} />
                <Button label="Share" kind="soft" size="sm" icon={<ShareIcon size={15} color={c.primary} />} onPress={() => void Share.share({ message: reminder.text })} />
                <Button label="UPI QR" kind="soft" size="sm" icon={<QrCode size={15} color={c.primary} />} onPress={() => router.push({ pathname: '/m/credit/qr', params: { amount: String(st.owed), note: `Dues ${customer.name}`.slice(0, 40) } })} />
              </View>
            </Card>
          </Section>
        ) : null}

        <Section title="Statement · last 90 days" action="Share" onAction={() => void Share.share({ message: statementText(data, statement) })}>
          <Card padded={false}>
            <ListRow dense title="Opening balance" value={inr(statement.opening, 0)} />
            {statement.entries.map((e) => (
              <ListRow key={e.docId} dense title={e.ref} subtitle={`${fmtDayShort(e.date)} · ${e.memo}`} value={e.debit ? `+${inr(e.debit, 0)}` : `−${inr(e.credit, 0)}`} valueTone={e.debit ? 'default' : 'success'} sub={`Balance ${inr(e.balance, 0)}`} />
            ))}
            <ListRow dense title="Closing balance" value={inr(statement.closing, 0)} />
          </Card>
          <Button label="Export CSV" kind="outline" size="sm" icon={<Download size={15} color={c.primary} />} style={{ alignSelf: 'flex-start' }}
            onPress={() => void shareFile(csvFileName(`statement ${customer.name}`), statementCsv(data, statement)).catch(() => toast('Could not export', 'err'))} />
        </Section>
      </View>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Credit terms" subtitle={customer.name} footer={<Button label="Save" size="lg" block onPress={saveTerms} />}>
        <View style={{ gap: 14 }}>
          <NumberField label="Days to pay" value={days} onChange={setDays} hint="How long after the sale it is due" />
          <MoneyField label="Credit limit (optional)" value={limit} onChange={setLimit} hint="The most they may owe at once. Leave empty for no limit." />
          <SwitchRow title="No credit for this customer" subtitle="They must pay at the counter" value={blocked} onChange={setBlocked} />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </View>
      </Sheet>
    </Screen>
  )
}
