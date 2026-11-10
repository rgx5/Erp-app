import React from 'react'
import { Linking, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import type { DataState } from '@/data/state'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip } from '@/ui/primitives'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ArrowDownToLine, ArrowUpFromLine, MessageCircle, Phone, ReceiptText } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import {
  canEditLines, canIssueParts, estimateText, IDENTIFIER_LABEL, isLate, JOB_LABEL, jobTotals, KIND_LABEL, lineTotal, nextJobStatuses, READING_LABEL, readyText, toIssue,
} from '@/modules/services/logic/jobs'
import { PhotoStrip } from '@/modules/services/ui/Photos'
import type { JobCard, JobLine, JobStatus } from '@/modules/services/types'
import { JOB_TONE, whatsApp, shareText } from '@/modules/services/ui/common'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, SplitPane, Toolbar, cellNum, type Column } from './kit'

type Mode = 'cash' | 'upi' | 'card' | 'due'
const MOVE_LABEL: Partial<Record<JobStatus, string>> = { estimated: 'Give estimate', approved: 'Approve', rejected: 'Refuse', in_work: 'Start work', ready: 'Mark ready', cancelled: 'Cancel' }
type LineRow = JobLine & { id: string }

export interface DesktopJobDetailProps {
  cur: JobCard; data: DataState; shop: string; now: number;
  lines: JobLine[]; patch: (lineId: string, p: Partial<JobLine>) => void; removeLine: (lineId: string) => void; addLabour: () => void; saveLines: () => void; dirty: boolean;
  issueQty: Record<string, string>; setIssueQty: (v: Record<string, string>) => void; returnQty: Record<string, string>; setReturnQty: (v: Record<string, string>) => void;
  move: (to: JobStatus) => void;
  approving: boolean; setApproving: (v: boolean) => void; approvedBy: string; setApprovedBy: (v: string) => void; approve: () => void;
  rejecting: boolean; setRejecting: (v: boolean) => void; reason: string; setReason: (v: string) => void; reject: () => void;
  delivering: boolean; setDelivering: (v: boolean) => void; receivedBy: string; setReceivedBy: (v: string) => void; deliver: () => void;
  billing: boolean; setBilling: (v: boolean) => void; mode: Mode; setMode: (v: Mode) => void; bill: () => void;
  onIssue: (lineId: string) => void; onReturn: (lineId: string) => void; hasDue: boolean;
}

/**
 * The desktop job-card screen: a toolbar with the status moves and hand-over action, a KPI strip for the
 * estimate total and age, a dense grid of the estimate's lines, and a side panel for the item, parts and photos
 * — instead of the phone's stacked cards. Every value and handler (`lines`, `move`, `approve`, `bill`, …) is the
 * exact state the phone `m/services/jobs/[id].tsx` already holds; this file only lays it out as a grid + panel.
 */
export function DesktopJobDetail(p: DesktopJobDetailProps) {
  const { c } = useTheme()
  const router = useRouter()
  const { cur, data, now } = p
  const editable = canEditLines(cur)
  const totals = jobTotals({ lines: p.lines })
  const phone = cur.partyPhone

  const rows: LineRow[] = (editable ? p.lines : cur.lines) as LineRow[]
  const columns: Array<Column<LineRow>> = editable
    ? [
        { key: 'name', label: 'Item', render: (r) => (
          r.kind === 'labour'
            ? <Field value={r.name} onChangeText={(t) => p.patch(r.id, { name: t })} placeholder="Labour description" />
            : <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        ) },
        { key: 'qty', label: 'Qty', width: 110, render: (r) => <NumberField value={String(r.qty)} onChange={(t) => p.patch(r.id, { qty: Number(t) || 0 })} decimals editable={(r.issued ?? 0) <= 0} /> },
        { key: 'price', label: 'Price', width: 130, render: (r) => <MoneyField value={String(r.price)} onChange={(t) => p.patch(r.id, { price: Number(t) || 0 })} /> },
        { key: 'line', label: 'Line total', width: 110, align: 'right', render: (r) => cellNum(inr(lineTotal(r), 0), true) },
        { key: 'rm', label: '', width: 80, render: (r) => ((r.issued ?? 0) <= 0 ? <Chip label="Remove" onPress={() => p.removeLine(r.id)} /> : null) },
      ]
    : [
        { key: 'name', label: 'Item', sortValue: (r) => r.name, render: (r) => <T style={dtext.cellStrong} numberOfLines={1}>{r.name}{r.qty !== 1 ? ` × ${r.qty}` : ''}</T> },
        { key: 'line', label: 'Line total', width: 130, align: 'right', sortValue: (r) => lineTotal(r), render: (r) => cellNum(inr(lineTotal(r), 0), true) },
      ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={cur.no}
          subtitle={`${cur.partyName} · ${cur.title}`}
          right={(
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {nextJobStatuses(cur.status).filter((s) => s !== 'delivered').map((s) => (
                <DeskButton key={s} label={MOVE_LABEL[s] ?? JOB_LABEL[s]} tone={s === 'rejected' || s === 'cancelled' ? 'danger' : 'default'} onPress={() => p.move(s)} />
              ))}
              {cur.status === 'ready' ? (
                totals.total > 0 && !cur.billId
                  ? <DeskButton label={`Bill & deliver · ${inr(totals.total, 0)}`} tone="primary" icon={<ReceiptText size={14} color={c.onPrimary} />} onPress={() => { p.setReceivedBy(''); p.setMode('cash'); p.setBilling(true) }} />
                  : <DeskButton label="Mark delivered" tone="primary" onPress={() => { p.setReceivedBy(''); p.setDelivering(true) }} />
              ) : null}
            </View>
          )}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Estimate total" value={inr(totals.total, 0)} tone="primary" delta={`${rows.length} ${rows.length === 1 ? 'line' : 'lines'}`} />
        <KpiTile label="Status" value={JOB_LABEL[cur.status]} tone={isLate(cur, now) ? 'danger' : JOB_TONE[cur.status]} delta={isLate(cur, now) ? 'Late' : cur.billId ? 'Billed' : KIND_LABEL[cur.kind]} />
      </KpiStrip>

      <SplitPane widths={['flex', 340]}>
        <View style={{ flex: 1, gap: 14, margin: 14 }}>
          <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable rows={rows} columns={columns} emptyLabel="No lines yet" />
          </View>
          {editable ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <DeskButton label="Add labour" onPress={p.addLabour} />
              {p.dirty ? <DeskButton label="Save estimate" tone="primary" onPress={p.saveLines} /> : null}
            </View>
          ) : null}

          {canIssueParts(cur) && cur.lines.some((l) => l.kind === 'part') ? (
            <View style={{ gap: 10 }}>
              <T style={[dtext.label, { color: c.inkMute }]}>Parts</T>
              {toIssue(cur).map(({ line, remaining }) => (
                <Card key={line.id} style={{ gap: 8 }}>
                  <T v="bodyStrong">{line.name}</T>
                  <T v="caption" tone="mute">{remaining} still to take from stock</T>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                    <NumberField containerStyle={{ flex: 1 }} value={p.issueQty[line.id] ?? String(remaining)} onChange={(t) => p.setIssueQty({ ...p.issueQty, [line.id]: t })} decimals />
                    <Button label="Issue" size="sm" icon={<ArrowDownToLine size={14} color={c.onPrimary} />} onPress={() => p.onIssue(line.id)} />
                  </View>
                </Card>
              ))}
              {cur.lines.filter((l) => l.kind === 'part' && (l.issued ?? 0) > 0).map((l) => (
                <Card key={`r-${l.id}`} style={{ gap: 8 }}>
                  <T v="bodyStrong">{l.name}</T>
                  <T v="caption" tone="mute">{l.issued} taken from stock</T>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                    <NumberField containerStyle={{ flex: 1 }} value={p.returnQty[l.id] ?? String(l.issued)} onChange={(t) => p.setReturnQty({ ...p.returnQty, [l.id]: t })} decimals />
                    <Button label="Return" kind="outline" size="sm" icon={<ArrowUpFromLine size={14} color={c.ink} />} onPress={() => p.onReturn(l.id)} />
                  </View>
                </Card>
              ))}
            </View>
          ) : null}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
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
                {cur.status === 'estimated' ? <Button label="Share estimate" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(estimateText(cur, p.shop), phone)} /> : null}
                {cur.status === 'ready' ? <Button label="Share ready" kind="success" size="sm" icon={<MessageCircle size={15} color="#fff" />} onPress={() => void whatsApp(readyText(cur, p.shop), phone)} /> : null}
              </View>
            ) : cur.status === 'estimated' ? <Button label="Share estimate" kind="soft" size="sm" style={{ marginTop: 12 }} onPress={() => void shareText(estimateText(cur, p.shop))} /> : null}
          </Card>

          {cur.photos.length ? <View style={{ gap: 8 }}><T style={[dtext.label, { color: c.inkMute }]}>Photos</T><PhotoStrip photos={cur.photos} readOnly /></View> : null}

          {cur.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: cur.customerId as string } } as never)} /> : null}
        </ScrollView>
      </SplitPane>

      <Sheet visible={p.approving} onClose={() => p.setApproving(false)} title="Approve the estimate" footer={<Button label="Approve" size="lg" block onPress={p.approve} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}><Field label="Approved by" value={p.approvedBy} onChangeText={p.setApprovedBy} placeholder="Meera, by phone" autoCapitalize="sentences" /></View>
      </Sheet>
      <Sheet visible={p.rejecting} onClose={() => p.setRejecting(false)} title="Refuse the estimate" footer={<Button label="Confirm" kind="danger" size="lg" block onPress={p.reject} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}><Field label="Why" value={p.reason} onChangeText={p.setReason} autoCapitalize="sentences" /></View>
      </Sheet>
      <Sheet visible={p.delivering} onClose={() => p.setDelivering(false)} title="Mark delivered" footer={<Button label="Confirm" size="lg" block onPress={p.deliver} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}><Field label="Collected by (optional)" value={p.receivedBy} onChangeText={p.setReceivedBy} autoCapitalize="words" /></View>
      </Sheet>
      <Sheet visible={p.billing} onClose={() => p.setBilling(false)} title={`Bill ${inr(totals.total, 0)}`} footer={<Button label="Bill & deliver" size="lg" block onPress={p.bill} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Segmented value={p.mode} onChange={p.setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, ...(p.hasDue ? [{ value: 'due' as const, label: 'On account' }] : [])]} />
          <Field label="Collected by (optional)" value={p.receivedBy} onChangeText={p.setReceivedBy} autoCapitalize="words" />
        </View>
      </Sheet>
    </DeskPage>
  )
}
