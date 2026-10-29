import React, { useState } from 'react'
import { Linking, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { id as newId } from '@/domain/ids'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { paymentMethodList } from '@/modules/registry'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ArrowDownToLine, ArrowUpFromLine, MessageCircle, Pencil, Phone, ReceiptText } from '@/ui/icons'
import { ask } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import {
  canEditLines, canIssueParts, estimateText, IDENTIFIER_LABEL, isLate, JOB_LABEL, jobTotals, KIND_LABEL, lineTotal, nextJobStatuses, READING_LABEL, readyText, toIssue,
} from '@/modules/services/logic/jobs'
import { billJobCard, issuePart, returnPart, setJobLines, setJobStatus } from '@/modules/services/ops'
import { PhotoStrip } from '@/modules/services/ui/Photos'
import type { JobLine, JobStatus } from '@/modules/services/types'
import { act, Denied, JOB_TONE, useShopName, VariantSelect, whatsApp, shareText } from '@/modules/services/ui/common'

type Mode = 'cash' | 'upi' | 'card' | 'due'
const MOVE_LABEL: Partial<Record<JobStatus, string>> = { estimated: 'Give estimate', approved: 'Approve', rejected: 'Refuse', in_work: 'Start work', ready: 'Mark ready', cancelled: 'Cancel' }

/** A job card: the item, its estimate, parts taken from stock, where it stands, and handing it back. */
export default function JobView() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('services')
  const data = useApp((s) => s.data)
  const shop = useShopName()
  const now = Date.now()
  const cur = data.jobCards?.[id]

  const [lines, setLines] = useState<JobLine[]>(cur?.lines ?? [])
  const [issueQty, setIssueQty] = useState<Record<string, string>>({})
  const [returnQty, setReturnQty] = useState<Record<string, string>>({})
  const [approving, setApproving] = useState(false)
  const [approvedBy, setApprovedBy] = useState('')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [delivering, setDelivering] = useState(false)
  const [receivedBy, setReceivedBy] = useState('')
  const [billing, setBilling] = useState(false)
  const [mode, setMode] = useState<Mode>('cash')

  if (!can) return <Denied title="Job card" who="Job cards are for people who work at the counter." />
  if (!cur) return <Screen title="Not found" back><T tone="mute">This job card is no longer here.</T></Screen>
  const editable = canEditLines(cur)
  const totals = jobTotals({ lines })
  const dirty = JSON.stringify(lines) !== JSON.stringify(cur.lines)
  const phone = cur.partyPhone
  const hasDue = paymentMethodList().some((m) => m.id === 'due') && !!cur.customerId

  function patch(lineId: string, p: Partial<JobLine>) { setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, ...p } : l))) }
  function addLabour() { setLines((ls) => [...ls, { id: newId('jl', now), kind: 'labour', name: '', qty: 1, price: 0 }]) }
  function saveLines() { const r = act((s, ctx) => setJobLines(s, cur!.id, lines, ctx), 'Estimate saved'); if (r) setLines(r.job.lines) }

  function move(to: JobStatus) {
    if (to === 'approved') { setApprovedBy(''); setApproving(true); return }
    if (to === 'rejected') { setReason(''); setRejecting(true); return }
    if (to === 'cancelled') { void (async () => { if (await ask({ title: `Cancel ${cur!.no}?`, confirm: 'Cancel it', danger: true })) act((s, ctx) => setJobStatus(s, cur!.id, 'cancelled', ctx)) })(); return }
    act((s, ctx) => setJobStatus(s, cur!.id, to, ctx))
  }
  function approve() { if (act((s, ctx) => setJobStatus(s, cur!.id, 'approved', ctx, { approvedBy }), 'Approved')) setApproving(false) }
  function reject() { if (act((s, ctx) => setJobStatus(s, cur!.id, 'rejected', ctx, { reason }), 'Estimate refused')) setRejecting(false) }
  function deliver() { if (act((s, ctx) => setJobStatus(s, cur!.id, 'delivered', ctx, { receivedBy }), 'Delivered')) setDelivering(false) }
  function bill() {
    const r = act((s, ctx) => billJobCard(s, cur!.id, [{ mode, amount: totals.total }], ctx, { receivedBy }), 'Billed')
    if (r) { setBilling(false); router.push({ pathname: '/bills/[id]', params: { id: r.bill.id } } as never) }
  }

  return (
    <Screen title={cur.no} subtitle={`${cur.partyName} · ${cur.title}`} back
      right={!editable ? undefined : <Button label="Edit" kind="soft" size="sm" icon={<Pencil size={15} color={c.primary} />} onPress={() => router.push({ pathname: '/m/services/jobs/new', params: { id: cur.id } })} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={JOB_TONE[cur.status]}>{JOB_LABEL[cur.status]}</Badge>
            {isLate(cur, now) ? <Badge tone="danger">Late</Badge> : null}
            {cur.billId ? <Badge tone="success">Billed</Badge> : null}
          </View>
          <View style={{ marginTop: 8 }}>
            <KV k="Item" v={`${KIND_LABEL[cur.kind]} · ${cur.title}`} />
            {cur.identifier ? <KV k={IDENTIFIER_LABEL[cur.kind]} v={cur.identifier} /> : null}
            {cur.reading ? <KV k={READING_LABEL[cur.kind]} v={cur.reading} /> : null}
            {cur.accessories ? <KV k="Accessories" v={cur.accessories} /> : null}
            {cur.condition ? <KV k="Condition" v={cur.condition} /> : null}
            <KV k="Problem" v={cur.problem} />
            <KV k="Received" v={fmtDate(cur.receivedAt)} />
            {cur.promisedAt ? <KV k="Promised by" v={fmtDate(cur.promisedAt)} /> : null}
            {cur.assignedTo ? <KV k="Assigned to" v={data.users[cur.assignedTo]?.name ?? '—'} /> : null}
            {cur.approvedBy ? <KV k="Approved by" v={cur.approvedBy} /> : null}
            {cur.rejectReason ? <KV k="Refused because" v={cur.rejectReason} tone="warning" /> : null}
            {cur.receivedBy ? <KV k="Collected by" v={cur.receivedBy} /> : null}
            {cur.notes ? <KV k="Notes" v={cur.notes} /> : null}
          </View>
          {phone ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <Button label="Call" kind="soft" size="sm" icon={<Phone size={15} color={c.primary} />} onPress={() => void Linking.openURL(`tel:${phone}`)} />
              {cur.status === 'estimated' ? <Button label="Share estimate" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(estimateText(cur, shop), phone)} /> : null}
              {cur.status === 'ready' ? <Button label="Share ready" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(readyText(cur, shop), phone)} /> : null}
            </View>
          ) : cur.status === 'estimated' ? <Button label="Share estimate" kind="soft" size="sm" style={{ marginTop: 12 }} onPress={() => void shareText(estimateText(cur, shop))} /> : null}
        </Card>

        {cur.photos.length ? <Section title="Photos" style={{ marginTop: 0 }}><PhotoStrip photos={cur.photos} readOnly /></Section> : null}

        <Section title="Estimate" style={{ marginTop: 0 }}>
          {editable ? (
            <View style={{ gap: 10 }}>
              {lines.map((l) => {
                const issued = l.issued ?? 0
                return (
                  <Card key={l.id} style={{ gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {l.kind === 'labour' ? <Field containerStyle={{ flex: 1 }} value={l.name} onChangeText={(t) => patch(l.id, { name: t })} placeholder="Labour description" /> : <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{l.name}</T>}
                      {issued <= 0 ? <Chip label="Remove" onPress={() => setLines(lines.filter((x) => x.id !== l.id))} /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <NumberField containerStyle={{ flex: 1 }} label="Qty" value={String(l.qty)} onChange={(t) => patch(l.id, { qty: Number(t) || 0 })} decimals editable={issued <= 0} />
                      <MoneyField containerStyle={{ flex: 1 }} label="Price" value={String(l.price)} onChange={(t) => patch(l.id, { price: Number(t) || 0 })} />
                    </View>
                    {issued > 0 ? <T v="caption" tone="mute">{issued} already taken from stock</T> : null}
                  </Card>
                )
              })}
              <Button label="Add labour" kind="soft" size="sm" onPress={addLabour} />
              <VariantSelect kind="part" value="" placeholder="Add a part from stock" onChange={(v, ch) => setLines([...lines, { id: newId('jl', now), kind: 'part', name: ch.name, qty: 1, price: ch.price, variantId: v }])} />
              <KV k="Total" v={inr(totals.total, 0)} strong />
              {dirty ? <Button label="Save estimate" onPress={saveLines} /> : null}
            </View>
          ) : cur.lines.length ? (
            <Card padded={false}>
              {cur.lines.map((l) => <KV key={l.id} k={`${l.name}${l.qty !== 1 ? ` × ${l.qty}` : ''}`} v={inr(lineTotal(l), 0)} />)}
              <KV k="Total" v={inr(jobTotals(cur).total, 0)} strong />
            </Card>
          ) : <T tone="mute">No lines yet.</T>}
        </Section>

        {canIssueParts(cur) && cur.lines.some((l) => l.kind === 'part') ? (
          <Section title="Parts" style={{ marginTop: 0 }}>
            <View style={{ gap: 10 }}>
              {toIssue(cur).map(({ line, remaining }) => (
                <Card key={line.id} style={{ gap: 8 }}>
                  <T v="bodyStrong">{line.name}</T>
                  <T v="caption" tone="mute">{remaining} still to take from stock</T>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                    <NumberField containerStyle={{ flex: 1 }} value={issueQty[line.id] ?? String(remaining)} onChange={(t) => setIssueQty({ ...issueQty, [line.id]: t })} decimals />
                    <Button label="Issue" size="sm" icon={<ArrowDownToLine size={14} color={c.onPrimary} />} onPress={() => act((s, ctx) => issuePart(s, cur!.id, line.id, Number(issueQty[line.id] ?? remaining) || 0, ctx), 'Taken from stock')} />
                  </View>
                </Card>
              ))}
              {cur.lines.filter((l) => l.kind === 'part' && (l.issued ?? 0) > 0).map((l) => (
                <Card key={`r-${l.id}`} style={{ gap: 8 }}>
                  <T v="bodyStrong">{l.name}</T>
                  <T v="caption" tone="mute">{l.issued} taken from stock</T>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                    <NumberField containerStyle={{ flex: 1 }} value={returnQty[l.id] ?? String(l.issued)} onChange={(t) => setReturnQty({ ...returnQty, [l.id]: t })} decimals />
                    <Button label="Return" kind="outline" size="sm" icon={<ArrowUpFromLine size={14} color={c.ink} />} onPress={() => act((s, ctx) => returnPart(s, cur!.id, l.id, Number(returnQty[l.id] ?? l.issued) || 0, ctx), 'Returned to stock')} />
                  </View>
                </Card>
              ))}
            </View>
          </Section>
        ) : null}

        {nextJobStatuses(cur.status).length ? (
          <Section title="Move it along" style={{ marginTop: 0 }}>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {nextJobStatuses(cur.status).filter((s) => s !== 'delivered').map((s) => (
                <Chip key={s} label={MOVE_LABEL[s] ?? JOB_LABEL[s]} tone={s === 'rejected' || s === 'cancelled' ? 'danger' : undefined} onPress={() => move(s)} />
              ))}
            </View>
          </Section>
        ) : null}

        {cur.status === 'ready' ? (
          <Section title="Hand it over" style={{ marginTop: 0 }}>
            {totals.total > 0 && !cur.billId ? (
              <Button label={`Bill & deliver · ${inr(totals.total, 0)}`} block icon={<ReceiptText size={18} color={c.onPrimary} />} onPress={() => { setReceivedBy(''); setMode('cash'); setBilling(true) }} />
            ) : (
              <Button label="Mark delivered" block onPress={() => { setReceivedBy(''); setDelivering(true) }} />
            )}
          </Section>
        ) : null}

        {cur.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: cur.customerId as string } } as never)} /> : null}
      </View>

      <Sheet visible={approving} onClose={() => setApproving(false)} title="Approve the estimate" footer={<Button label="Approve" size="lg" block onPress={approve} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}><Field label="Approved by" value={approvedBy} onChangeText={setApprovedBy} placeholder="Meera, by phone" autoCapitalize="sentences" /></View>
      </Sheet>
      <Sheet visible={rejecting} onClose={() => setRejecting(false)} title="Refuse the estimate" footer={<Button label="Confirm" kind="danger" size="lg" block onPress={reject} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}><Field label="Why" value={reason} onChangeText={setReason} autoCapitalize="sentences" /></View>
      </Sheet>
      <Sheet visible={delivering} onClose={() => setDelivering(false)} title="Mark delivered" footer={<Button label="Confirm" size="lg" block onPress={deliver} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}><Field label="Collected by (optional)" value={receivedBy} onChangeText={setReceivedBy} autoCapitalize="words" /></View>
      </Sheet>
      <Sheet visible={billing} onClose={() => setBilling(false)} title={`Bill ${inr(totals.total, 0)}`} footer={<Button label="Bill & deliver" size="lg" block onPress={bill} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, ...(hasDue ? [{ value: 'due' as const, label: 'On account' }] : [])]} />
          <Field label="Collected by (optional)" value={receivedBy} onChangeText={setReceivedBy} autoCapitalize="words" />
        </View>
      </Sheet>
    </Screen>
  )
}
