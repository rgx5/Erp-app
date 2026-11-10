import React from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Card, Chip, ProgressBar } from '@/ui/primitives'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Pause, Play, Plus, ReceiptText, Trash } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'
import { entriesOf, entryAmount, entryMinutes, hoursOf, PROJECT_LABEL, projectSummary, TASK_LABEL } from '@/modules/services/logic/projects'
import { DateField } from '@/modules/services/ui/common'
import type { Project, ProjectStatus, ProjectTask, TaskStatus, TimeEntry } from '@/modules/services/types'
import type { DataState } from '@/data/state'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, SplitPane, Toolbar, cellNum, type Column } from './kit'

const STATUS_TONE: Record<ProjectStatus, Tone> = { active: 'primary', on_hold: 'warning', completed: 'success', cancelled: 'default' }
const TASK_TONE: Record<TaskStatus, Tone> = { todo: 'default', doing: 'warning', done: 'success' }
type Mode = 'cash' | 'upi' | 'card' | 'due'
type EntryRow = TimeEntry & { id: string }

export interface DesktopProjectDetailProps {
  p: Project; data: DataState; now: number; team: Array<{ id: string; name: string }>
  tasks: ProjectTask[]; myTimerHere: TimeEntry | undefined; mine: TimeEntry | undefined; hasDue: boolean
  startTask_: () => void; openTask: (t: ProjectTask) => void; saveTask_: () => void; deleteTask_: () => void; cycleTaskStatus: (t: ProjectTask) => void
  editTask: { id?: string } | null; setEditTask: (v: { id?: string } | null) => void
  taskTitle: string; setTaskTitle: (v: string) => void; taskAssignee: string; setTaskAssignee: (v: string) => void
  taskHours: string; setTaskHours: (v: string) => void; taskDue: string; setTaskDue: (v: string) => void; taskBillable: boolean; setTaskBillable: (v: boolean) => void
  doStart: () => void; doStop: (entryId: string) => void
  starting: boolean; setStarting: (v: boolean) => void; startTask: string; setStartTask: (v: string) => void
  startBillable: boolean; setStartBillable: (v: boolean) => void; startNote: string; setStartNote: (v: string) => void
  openNewEntry: () => void; openEntry: (e: TimeEntry) => void; saveEntry: () => void; deleteEntry: () => void
  editEntry: { id?: string } | null; setEditEntry: (v: { id?: string } | null) => void
  entryDate: string; setEntryDate: (v: string) => void; entryMin: string; setEntryMin: (v: string) => void
  entryTask: string; setEntryTask: (v: string) => void; entryBillable: boolean; setEntryBillable: (v: boolean) => void; entryNote: string; setEntryNote: (v: string) => void
  billHours: () => void; invoiceFee: () => void
  billing: boolean; setBilling: (v: boolean) => void; mode: Mode; setMode: (v: Mode) => void
  invoicing: boolean; setInvoicing: (v: boolean) => void; amount: string; setAmount: (v: string) => void; label: string; setLabel: (v: string) => void
  setProjectStatus_: (s: ProjectStatus) => void
}

/**
 * The desktop project screen: a toolbar with the status moves and timer, a KPI strip for hours and billing, a
 * grid of logged time, and a side panel for tasks and the billing cards — the same state and operations
 * (`projectSummary`, `startTimer`, `logTime`, `invoiceTimesheet`, …) the phone `m/services/projects/[id].tsx` holds.
 */
export function DesktopProjectDetail(p: DesktopProjectDetailProps) {
  const { c } = useTheme()
  const router = useRouter()
  const { data, now } = p
  const pr = p.p
  const summary = projectSummary(data, pr, now)

  const rows: EntryRow[] = entriesOf(data, pr.id).slice(0, 60) as EntryRow[]
  const columns: Array<Column<EntryRow>> = [
    { key: 'hours', label: 'Entry', render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{hoursOf(entryMinutes(r, now))} h{r.taskId ? ` · ${data.projectTasks?.[r.taskId]?.title ?? ''}` : ''}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{fmtDate(r.date)} · {data.users[r.userId]?.name ?? ''}{r.runningSince ? ' · running' : ''}</T>
      </View>
    ) },
    { key: 'status', label: 'Status', width: 120, render: (r) => <T style={dtext.cell}>{r.billId ? 'Invoiced' : r.billable ? 'Billable' : 'Not billable'}</T> },
    { key: 'amount', label: 'Amount', width: 110, align: 'right', render: (r) => (r.billable ? cellNum(inr(entryAmount(r, now), 0)) : null) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={pr.name}
          subtitle={pr.no}
          right={(
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {pr.status !== 'cancelled' ? (['active', 'on_hold', 'completed'] as ProjectStatus[]).filter((s) => s !== pr.status).map((s) => (
                <DeskButton key={s} label={PROJECT_LABEL[s]} onPress={() => p.setProjectStatus_(s)} />
              )) : null}
              {pr.status !== 'cancelled' ? <DeskButton label="Cancel" tone="danger" onPress={() => p.setProjectStatus_('cancelled')} /> : null}
            </View>
          )}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Hours worked" value={`${summary.hours} h`} tone="primary" delta={pr.budgetHours > 0 ? `${summary.budgetPct}% of ${pr.budgetHours} h` : undefined} />
        <KpiTile label="Status" value={PROJECT_LABEL[pr.status]} tone={STATUS_TONE[pr.status]} />
        {pr.billing === 'hourly'
          ? <KpiTile label="Unbilled" value={inr(summary.unbilledAmount, 0)} tone="success" delta={`${summary.unbilledHours} h`} />
          : <KpiTile label="Left to invoice" value={inr(summary.fixedLeft, 0)} tone="success" delta={`${inr(pr.fixedInvoiced, 0)} invoiced`} />}
      </KpiStrip>

      <SplitPane widths={['flex', 340]}>
        <View style={{ flex: 1, gap: 14, margin: 14 }}>
          {pr.budgetHours > 0 ? <ProgressBar value={(summary.budgetPct ?? 0) / 100} tone={(summary.budgetPct ?? 0) > 100 ? 'danger' : 'primary'} /> : null}

          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            {p.myTimerHere ? (
              <DeskButton label={`Stop timer · ${hoursOf(entryMinutes(p.myTimerHere, now))} h`} tone="danger" icon={<Pause size={14} color={c.danger} />} onPress={() => p.doStop(p.myTimerHere!.id)} />
            ) : p.mine ? (
              <T tone="mute">A timer is running on {data.projects?.[p.mine.projectId]?.name ?? 'another project'}.</T>
            ) : pr.status === 'active' ? (
              <DeskButton label="Start timer" icon={<Play size={14} color={c.ink} />} onPress={() => { p.setStartTask(''); p.setStartBillable(pr.billing === 'hourly'); p.setStartNote(''); p.setStarting(true) }} />
            ) : null}
            <DeskButton label="Add time manually" onPress={p.openNewEntry} />
          </View>

          <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable rows={rows} columns={columns} onRowPress={(r) => (r.runningSince ? undefined : p.openEntry(r))} emptyLabel="No time logged yet" />
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Card style={{ flex: 1, gap: 8 }}>
              <KV k="Customer" v={pr.customerId ? data.customers[pr.customerId]?.name ?? '—' : 'None'} />
              <KV k="Billing" v={pr.billing === 'hourly' ? `Hourly · ${inr(pr.hourlyRate, 0)}/h` : `Fixed fee · ${inr(pr.fixedAmount, 0)}`} />
              {pr.startDate ? <KV k="Start" v={fmtDate(pr.startDate)} /> : null}
              {pr.dueDate ? <KV k="Due" v={fmtDate(pr.dueDate)} /> : null}
              {pr.notes ? <KV k="Notes" v={pr.notes} /> : null}
            </Card>
            {pr.billing === 'hourly'
              ? <DeskButton label="Bill unbilled hours" tone="primary" disabled={!summary.unbilledAmount} icon={<ReceiptText size={14} color={c.onPrimary} />} onPress={() => { p.setMode('cash'); p.setBilling(true) }} />
              : <DeskButton label="Invoice an amount" tone="primary" disabled={!summary.fixedLeft} icon={<ReceiptText size={14} color={c.onPrimary} />} onPress={() => { p.setAmount(String(summary.fixedLeft)); p.setLabel(''); p.setMode('cash'); p.setInvoicing(true) }} />}
          </View>

          {pr.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: pr.customerId as string } } as never)} /> : null}
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <T style={[dtext.label, { color: c.inkMute }]}>Tasks</T>
            <DeskButton label="Add" icon={<Plus size={13} color={c.ink} />} onPress={p.startTask_} />
          </View>
          {p.tasks.length ? p.tasks.map((t) => (
            <Card key={t.id} style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <T v="bodyStrong" numberOfLines={1}>{t.title}</T>
                  <T v="caption" tone="mute">{t.assigneeId ? data.users[t.assigneeId]?.name ?? '' : 'Unassigned'}{t.estHours ? ` · ${t.estHours} h est.` : ''}</T>
                </View>
                <Chip label={TASK_LABEL[t.status]} tone={TASK_TONE[t.status]} onPress={() => p.cycleTaskStatus(t)} />
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label="Edit" kind="ghost" size="sm" onPress={() => p.openTask(t)} />
              </View>
            </Card>
          )) : <T tone="mute">No tasks yet</T>}
        </ScrollView>
      </SplitPane>

      <Sheet visible={!!p.editTask} onClose={() => p.setEditTask(null)} full title={p.editTask?.id ? 'Edit task' : 'New task'}
        footer={<View style={{ gap: 10 }}><Button label="Save" size="lg" block onPress={p.saveTask_} />{p.editTask?.id ? <Button label="Delete" kind="outline" block onPress={() => void p.deleteTask_()} /> : null}</View>}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Field label="Title" value={p.taskTitle} onChangeText={p.setTaskTitle} autoCapitalize="sentences" />
          <Select label="Assignee (optional)" value={p.taskAssignee} placeholder="Unassigned" options={[{ value: '', label: 'Unassigned' }, ...p.team.map((u) => ({ value: u.id, label: u.name }))]} onChange={p.setTaskAssignee} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumberField containerStyle={{ flex: 1 }} label="Estimated hours" value={p.taskHours} onChange={p.setTaskHours} decimals />
            <View style={{ flex: 1 }}><DateField label="Due (optional)" value={p.taskDue} onChange={p.setTaskDue} /></View>
          </View>
          <SwitchRow title="Billable" subtitle="Time logged on this task can be invoiced" value={p.taskBillable} onChange={p.setTaskBillable} />
        </View>
      </Sheet>

      <Sheet visible={p.starting} onClose={() => p.setStarting(false)} title="Start the timer" footer={<Button label="Start" size="lg" block onPress={p.doStart} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          {p.tasks.length ? <Select label="Task (optional)" value={p.startTask} placeholder="None" options={[{ value: '', label: 'None' }, ...p.tasks.map((t) => ({ value: t.id, label: t.title }))]} onChange={p.setStartTask} /> : null}
          <SwitchRow title="Billable" value={p.startBillable} onChange={p.setStartBillable} />
          <Field label="Note (optional)" value={p.startNote} onChangeText={p.setStartNote} />
        </View>
      </Sheet>

      <Sheet visible={!!p.editEntry} onClose={() => p.setEditEntry(null)} full title={p.editEntry?.id ? 'Edit time' : 'Add time'}
        footer={<View style={{ gap: 10 }}><Button label="Save" size="lg" block onPress={p.saveEntry} />{p.editEntry?.id ? <Button label="Delete" kind="outline" block icon={<Trash size={16} color={c.ink} />} onPress={() => void p.deleteEntry()} /> : null}</View>}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <DateField label="Date" value={p.entryDate} onChange={p.setEntryDate} />
          <NumberField label="Minutes" value={p.entryMin} onChange={p.setEntryMin} />
          {p.tasks.length ? <Select label="Task (optional)" value={p.entryTask} placeholder="None" options={[{ value: '', label: 'None' }, ...p.tasks.map((t) => ({ value: t.id, label: t.title }))]} onChange={p.setEntryTask} /> : null}
          <SwitchRow title="Billable" value={p.entryBillable} onChange={p.setEntryBillable} disabled={pr.billing !== 'hourly'} />
          <Field label="Note (optional)" value={p.entryNote} onChangeText={p.setEntryNote} />
        </View>
      </Sheet>

      <Sheet visible={p.billing} onClose={() => p.setBilling(false)} title={`Bill ${inr(summary.unbilledAmount, 0)}`} footer={<Button label="Bill it" size="lg" block onPress={p.billHours} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Segmented value={p.mode} onChange={p.setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, ...(p.hasDue ? [{ value: 'due' as const, label: 'On account' }] : [])]} />
          <T v="caption" tone="mute">Every billable hour not yet invoiced goes on one bill.</T>
        </View>
      </Sheet>

      <Sheet visible={p.invoicing} onClose={() => p.setInvoicing(false)} title="Invoice an amount" footer={<Button label="Bill it" size="lg" block onPress={p.invoiceFee} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <MoneyField label="Amount" value={p.amount} onChange={p.setAmount} hint={`Up to ${inr(summary.fixedLeft, 0)} left on this project.`} />
          <Field label="Label (optional)" value={p.label} onChangeText={p.setLabel} placeholder="Advance, milestone 1…" />
          <Segmented value={p.mode} onChange={p.setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, ...(p.hasDue ? [{ value: 'due' as const, label: 'On account' }] : [])]} />
        </View>
      </Sheet>
    </DeskPage>
  )
}
