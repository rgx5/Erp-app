import React, { useState } from 'react'
import { Linking, Pressable, ScrollView, Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { Customer } from '@/domain/types'
import type { CreditStatus, Statement } from '@/modules/credit/logic'
import type { Reminder } from '@/modules/credit/reminders'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, MessageCircle, Pencil, QrCode, Send, Share as ShareIcon } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, SplitPane, Toolbar } from './kit'

export interface OpenBill { billId: string; no: string; date: number; dueDate: number; outstanding: number; amount: number }

export interface DesktopCustomerAccountProps {
  id: string
  customer: Customer
  canTerms: boolean
  now: number
  st: CreditStatus
  open: OpenBill[]
  statement: Statement
  reminder: Reminder | null
  statementShareText: string
  initialDays: string
  initialLimit: string
  initialBlocked: boolean
  initialNotes: string
  onSaveTerms: (d: { creditLimit: number; creditDays: number; blocked: boolean; notes: string }) => void
  onExportCsv: () => void
}

/**
 * The desktop credit-account screen: a KPI strip for what's owed, the unpaid bills and the statement as dense
 * grids in the main pane, and the reminder/terms actions in a side panel — instead of stacked `Section`s. Every
 * figure (`st`, `open`, `statement`, `reminder`) is passed down exactly as the phone `credit/customer/[id].tsx`
 * computes it.
 */
export function DesktopCustomerAccount(p: DesktopCustomerAccountProps) {
  const { c } = useTheme()
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [days, setDays] = useState(p.initialDays)
  const [limit, setLimit] = useState(p.initialLimit)
  const [blocked, setBlocked] = useState(p.initialBlocked)
  const [notes, setNotes] = useState(p.initialNotes)

  function openEditor() { setDays(p.initialDays); setLimit(p.initialLimit); setBlocked(p.initialBlocked); setNotes(p.initialNotes); setEditing(true) }
  function save() { p.onSaveTerms({ creditLimit: Number(limit) || 0, creditDays: Number(days), blocked, notes }); setEditing(false) }
  const open_ = (url: string | null) => { if (url) Linking.openURL(url).catch(() => toast('Could not open the app', 'err')); else toast('This customer has no usable phone number', 'err') }

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={p.customer.name}
          subtitle="Credit account"
          right={<DeskButton label={p.st.owed > 0 ? `Collect from ${p.customer.name.split(' ')[0]}` : 'Receive a payment'} tone="primary" onPress={() => router.push({ pathname: '/m/credit/collect', params: { customerId: p.id, ...(p.st.owed > 0 ? { amount: String(p.st.owed) } : {}) } })} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label={p.st.owed < 0 ? 'Paid in advance' : 'Owes'} value={inr(Math.abs(p.st.owed), 0)} tone={p.st.owed < 0 ? 'success' : 'primary'} />
        {p.st.overdue > 0 ? <KpiTile label="Overdue" value={inr(p.st.overdue, 0)} tone="danger" delta={`${p.st.oldestDaysOverdue} days late at most`} /> : null}
        <KpiTile label="Credit limit" value={p.st.limit > 0 ? inr(p.st.limit, 0) : 'None'} delta={p.st.available !== null ? `${inr(p.st.available, 0)} left` : undefined} />
      </KpiStrip>

      {p.st.blocked ? <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><Notice tone="danger" title="Not allowed to buy on account" /></View> : null}

      <SplitPane widths={['flex', 340]}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <View style={{ height: 30, borderBottomWidth: 1, borderBottomColor: c.lineStrong, backgroundColor: c.sunken, paddingHorizontal: 10, justifyContent: 'center' }}>
              <T style={[dtext.label, { color: c.inkMute }]}>{`Unpaid bills · ${p.open.length}`}</T>
            </View>
            {p.open.length ? p.open.map((b, i) => (
              <Pressable key={b.billId} onPress={() => router.push({ pathname: '/m/credit/return/[billId]', params: { billId: b.billId } })} style={{ flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 12, gap: 10, backgroundColor: i % 2 ? c.surfaceAlt : 'transparent', borderBottomWidth: 1, borderBottomColor: c.line }}>
                <View style={{ flex: 1, gap: 1 }}>
                  <T style={dtext.cellStrong} numberOfLines={1}>{b.no}</T>
                  <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>Sold {fmtDayShort(b.date)} · due {fmtDayShort(b.dueDate)}</T>
                </View>
                {b.dueDate < p.now ? <Pill tone="danger" label="Overdue" /> : null}
                <T style={dtext.numStrong}>{inr(b.outstanding, 0)}</T>
              </Pressable>
            )) : <View style={{ padding: 16 }}><T style={[dtext.cell, { color: c.inkMute }]}>Nothing unpaid.</T></View>}
          </View>
          {p.open.length ? <T style={[dtext.tiny, { color: c.inkMute }]}>Tap a bill to return goods from it — the amount owed comes down first.</T> : null}

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <View style={{ height: 30, borderBottomWidth: 1, borderBottomColor: c.lineStrong, backgroundColor: c.sunken, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 }}>
              <T style={[dtext.label, { color: c.inkMute }]}>Statement · last 90 days</T>
              <Pressable onPress={() => void Share.share({ message: p.statementShareText })}><T style={[dtext.cellStrong, { color: c.primary }]}>Share</T></Pressable>
            </View>
            <StatementRow title="Opening balance" value={inr(p.statement.opening, 0)} />
            {p.statement.entries.map((e, i) => (
              <StatementRow key={e.docId} title={e.ref} sub={`${fmtDayShort(e.date)} · ${e.memo}`} value={`${e.debit ? '+' : '−'}${inr(e.debit || e.credit, 0)}`} success={!e.debit} zebra={i % 2 === 1} />
            ))}
            <StatementRow title="Closing balance" value={inr(p.statement.closing, 0)} />
          </View>
          <DeskButton label="Export CSV" icon={<Download size={13} color={c.ink} />} onPress={p.onExportCsv} />
        </ScrollView>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <KV k="Days to pay" v={String(p.st.creditDays)} />
            {p.canTerms ? <Button label="Change terms" kind="soft" size="sm" icon={<Pencil size={15} color={c.primary} />} onPress={openEditor} style={{ marginTop: 10, alignSelf: 'flex-start' }} /> : null}
          </View>

          {p.reminder ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Remind</T>
              <T style={[dtext.tiny, { color: c.inkMute }]}>{p.reminder.text}</T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button label="WhatsApp" kind="success" size="sm" icon={<MessageCircle size={15} color={c.onPrimary} />} onPress={() => open_(p.reminder!.whatsapp)} />
                <Button label="SMS" kind="soft" size="sm" icon={<Send size={15} color={c.primary} />} onPress={() => open_(p.reminder!.sms)} />
                <Button label="Share" kind="soft" size="sm" icon={<ShareIcon size={15} color={c.primary} />} onPress={() => void Share.share({ message: p.reminder!.text })} />
                <Button label="UPI QR" kind="soft" size="sm" icon={<QrCode size={15} color={c.primary} />} onPress={() => router.push({ pathname: '/m/credit/qr', params: { amount: String(p.st.owed), note: `Dues ${p.customer.name}`.slice(0, 40) } })} />
              </View>
            </View>
          ) : null}
        </ScrollView>
      </SplitPane>

      <Sheet visible={editing} onClose={() => setEditing(false)} title="Credit terms" subtitle={p.customer.name} footer={<Button label="Save" size="lg" block onPress={save} />}>
        <View style={{ gap: 14 }}>
          <NumberField label="Days to pay" value={days} onChange={setDays} hint="How long after the sale it is due" />
          <MoneyField label="Credit limit (optional)" value={limit} onChange={setLimit} hint="The most they may owe at once. Leave empty for no limit." />
          <SwitchRow title="No credit for this customer" subtitle="They must pay at the counter" value={blocked} onChange={setBlocked} />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </View>
      </Sheet>
    </DeskPage>
  )
}

function StatementRow({ title, sub, value, success, zebra }: { title: string; sub?: string; value: string; success?: boolean; zebra?: boolean }) {
  const { c } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: sub ? 40 : 32, paddingHorizontal: 12, gap: 10, backgroundColor: zebra ? c.surfaceAlt : 'transparent', borderBottomWidth: 1, borderBottomColor: c.line }}>
      <View style={{ flex: 1, gap: sub ? 1 : 0 }}>
        <T style={dtext.cell} numberOfLines={1}>{title}</T>
        {sub ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{sub}</T> : null}
      </View>
      <T style={[dtext.num, success ? { color: c.success } : null]}>{value}</T>
    </View>
  )
}
