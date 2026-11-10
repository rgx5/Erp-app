import React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { FREQUENCY_LABEL, PERIODS_PER_YEAR, type periodsDue, type scheduleAhead } from '@/modules/sales-docs/logic/subscriptions'
import type { Subscription } from '@/modules/sales-docs/types'
import type { Bill, Customer } from '@/domain/types'
import { KV, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Pause, Pencil, Play, Receipt, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, SplitPane, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type ItemRow = { id: string; name: string; qty: number; total: number }

export interface DesktopPlanDetailProps {
  sub: Subscription
  customer: Customer | undefined
  each: number
  due: ReturnType<typeof periodsDue>
  made: Bill[]
  schedule: ReturnType<typeof scheduleAhead>
  now: number
  onGenerate: () => void
  onToggle: () => void
  onDelete: () => void
  onEdit: () => void
  onOpenBill: (id: string) => void
}

/**
 * The desktop recurring-plan screen: a toolbar with "Make N invoices" as the primary action when any are due, a
 * dense grid of what each invoice bills, and a side panel with the schedule, invoices made and manage actions.
 * Every value comes from `src/app/m/sales-docs/recurring/[id].tsx` unchanged.
 */
export function DesktopPlanDetail(p: DesktopPlanDetailProps) {
  const { c } = useTheme()
  const { sub, customer, each, due, made, schedule, now } = p

  const rows: ItemRow[] = sub.items.map((l) => ({ id: l.variantId, name: `${l.name} × ${l.qty}`, qty: l.qty, total: l.price * l.qty }))
  const columns: Array<Column<ItemRow>> = [
    { key: 'name', label: 'Each invoice bills', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'total', label: 'Amount', width: 120, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr(r.total, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={<Toolbar title={sub.no} subtitle={customer?.name ?? 'Customer'} right={due.length ? <DeskButton label={`Make ${due.length} invoice${due.length === 1 ? '' : 's'} · ${inr(each * due.length, 0)}`} tone="primary" icon={<Receipt size={14} color={c.onPrimary} />} onPress={p.onGenerate} /> : undefined} />}
    >
      {due.length ? <View style={{ paddingHorizontal: 20, paddingTop: 10 }}><Notice tone="warning" title={`${due.length} invoice${due.length === 1 ? ' is' : 's are'} due`} body="Stock is taken out and the customer is billed like any other sale." /></View> : null}

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No items on this plan" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pill tone={sub.kind === 'amc' ? 'accent' : 'primary'} label={sub.kind === 'amc' ? 'AMC' : 'Subscription'} />
            <Pill tone={sub.active ? 'success' : 'default'} label={sub.active ? 'Active' : 'Paused or ended'} />
          </View>

          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
            <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Details</T>
            <KV k="Each invoice" v={inr(each)} strong />
            <KV k="Repeats" v={FREQUENCY_LABEL[sub.frequency]} />
            <KV k="Worth per year" v={inr(each * PERIODS_PER_YEAR[sub.frequency], 0)} />
            <KV k="Next invoice" v={fmtDate(sub.nextDate)} />
            {sub.endDate ? <KV k="Ends" v={fmtDate(sub.endDate)} /> : null}
            <KV k="Settled" v={sub.payMode === 'due' ? 'On account' : sub.payMode.toUpperCase()} />
            <KV k="Invoices made" v={String(sub.billCount)} />
          </View>

          {sub.coverage ? <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}><T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Covered</T><T style={dtext.cell}>{sub.coverage}</T></View> : null}

          {sub.active ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 6 }]}>Coming up</T>
              {schedule.map((d, i) => <KV key={i} k={fmtDate(d)} v={d <= now ? 'Due' : ''} tone="warning" />)}
            </View>
          ) : null}

          {made.length ? (
            <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 4 }}>
              <T style={[dtext.label, { color: c.inkMute, marginBottom: 2 }]}>Invoices made</T>
              {made.slice(0, 12).map((b) => <Pressable key={b.id} onPress={() => p.onOpenBill(b.id)}><KV k={b.no} v={inr(b.total, 0)} sub={fmtDate(b.date)} tone="primary" /></Pressable>)}
            </View>
          ) : null}

          <View style={{ gap: 8 }}>
            <DeskButton label="Edit plan" icon={<Pencil size={14} color={c.ink} />} onPress={p.onEdit} />
            <DeskButton label={sub.active ? 'Pause' : 'Resume'} icon={sub.active ? <Pause size={14} color={c.ink} /> : <Play size={14} color={c.ink} />} onPress={p.onToggle} />
            {sub.billCount === 0 ? <DeskButton label="Delete plan" tone="danger" icon={<Trash size={14} color={c.danger} />} onPress={p.onDelete} /> : null}
          </View>
        </ScrollView>
      </SplitPane>
    </DeskPage>
  )
}
