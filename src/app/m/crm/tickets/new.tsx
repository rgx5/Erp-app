import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { listOf } from '@/data/state'
import { perform, useApp, useCan } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { saveTicket } from '@/modules/crm/ops'
import { settingsOf } from '@/modules/crm/settings'
import { KIND_LABEL, PRIORITY_LABEL, warrantyCover } from '@/modules/crm/tickets'
import type { TicketKind, TicketPriority } from '@/modules/crm/types'
import { CustomerField, failWith } from '@/modules/crm/ui/forms'

/** Open a complaint, an after-sales request or a warranty claim. */
export default function TicketNew() {
  const router = useRouter()
  const params = useLocalSearchParams<{ customerId?: string; billId?: string; kind?: TicketKind }>()
  const can = useCan('customers')
  const data = useApp((s) => s.data)
  const [kind, setKind] = useState<TicketKind>(params.kind ?? 'complaint')
  const [customerId, setCustomerId] = useState<string | undefined>(params.customerId ?? (params.billId ? data.bills[params.billId]?.customerId ?? undefined : undefined))
  const [partyName, setPartyName] = useState('')
  const [billId, setBillId] = useState(params.billId ?? '')
  const [itemName, setItemName] = useState('')
  const [serial, setSerial] = useState('')
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TicketPriority>('normal')
  const cfg = settingsOf(data)
  const bills = useMemo(() => (customerId ? listOf(data.bills).filter((b) => b.customerId === customerId && !b.refundOfBillId && b.status !== 'held').sort((a, b) => b.date - a.date).slice(0, 40) : []), [data.bills, customerId])
  const bill = billId ? data.bills[billId] : undefined
  const cover = bill && kind === 'warranty' ? warrantyCover(bill.date, cfg.warrantyMonths, Date.now()) : null

  if (!can) return <Screen title="New ticket" back><T tone="mute">Tickets are for people who use the billing counter.</T></Screen>
  function save() {
    try {
      const r = perform((s, ctx) => saveTicket(s, { kind, subject, description, priority, ...(customerId ? { customerId } : { partyName }), ...(billId ? { billId } : {}), itemName, serial }, ctx))
      toast(`${r.ticket.no} opened`, 'ok')
      router.replace({ pathname: '/m/crm/tickets/[id]', params: { id: r.ticket.id } })
    } catch (e) { failWith(e) }
  }
  return (
    <Screen title="New ticket" back footer={<Button label="Open ticket" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        <Segmented value={kind} onChange={setKind} options={(Object.keys(KIND_LABEL) as TicketKind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <CustomerField value={customerId} onChange={(cu) => { setCustomerId(cu?.id); setBillId('') }} />
        {!customerId ? <Field label="Or type a name" value={partyName} onChangeText={setPartyName} autoCapitalize="words" /> : null}
        {customerId ? (
          <Select label={kind === 'warranty' ? 'Bill of purchase' : 'Bill it is about (optional)'} value={billId} placeholder="Choose a bill" searchable
            options={[{ value: '', label: 'No bill' }, ...bills.map((b) => ({ value: b.id, label: `${b.no} · ${fmtDate(b.date)}`, sub: `${inr(b.total, 0)} · ${b.items.map((i) => i.name).slice(0, 2).join(', ')}` }))]}
            onChange={(v) => { setBillId(v); const b = data.bills[v]; if (b && !itemName) setItemName(b.items[0]?.name ?? '') }} />
        ) : null}
        {kind !== 'complaint' ? <Field label="Product" value={itemName} onChangeText={setItemName} autoCapitalize="words" /> : null}
        {kind === 'warranty' ? <Field label="Serial / IMEI (optional)" value={serial} onChangeText={setSerial} autoCapitalize="characters" mono /> : null}
        {cover ? <Notice tone={cover.covered ? 'success' : 'warning'} title={cover.covered ? `Under warranty until ${fmtDate(cover.endsAt)}` : `Warranty ended on ${fmtDate(cover.endsAt)}`} body={`Counted as ${cfg.warrantyMonths} months from the bill. Change this in the CRM settings.`} /> : null}
        <Field label="What is the problem?" value={subject} onChangeText={setSubject} autoCapitalize="sentences" />
        <Field label="Details (optional)" value={description} onChangeText={setDescription} multiline autoCapitalize="sentences" />
        <Segmented value={priority} onChange={setPriority} options={(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))} />
        <T v="caption" tone="mute">To be settled within {cfg.slaHours[priority]} hours.</T>
      </View>
    </Screen>
  )
}
