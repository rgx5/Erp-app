import React, { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan, useUser } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip, Group, ProgressBar } from '@/ui/primitives'
import { EmptyState, KV, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Pause, Pencil, Play, Plus, ReceiptText, Trash } from '@/ui/icons'
import { ask } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import type { Tone } from '@/ui/theme'
import { entriesOf, entryAmount, entryMinutes, hoursOf, PROJECT_LABEL, projectSummary, runningTimer, TASK_LABEL, tasksOf } from '@/modules/services/logic/projects'
import { deleteTask, deleteTime, editTime, invoiceFixedFee, invoiceTimesheet, logTime, saveTask, setProjectStatus, setTaskStatus, startTimer, stopTimer } from '@/modules/services/ops'
import { paymentMethodList } from '@/modules/registry'
import type { ProjectStatus, ProjectTask, TaskStatus, TimeEntry } from '@/modules/services/types'
import { act, DateField, dayText, dayValue, Denied, useTeam } from '@/modules/services/ui/common'

const STATUS_TONE: Record<ProjectStatus, Tone> = { active: 'primary', on_hold: 'warning', completed: 'success', cancelled: 'default' }
const TASK_TONE: Record<TaskStatus, Tone> = { todo: 'default', doing: 'warning', done: 'success' }
const TASK_NEXT: Record<TaskStatus, TaskStatus> = { todo: 'doing', doing: 'done', done: 'todo' }
type Mode = 'cash' | 'upi' | 'card' | 'due'

/** A project: its tasks, the time worked on it (with a start/stop timer), and billing the customer for it. */
export default function ProjectView() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('services')
  const me = useUser()
  const data = useApp((s) => s.data)
  const now = Date.now()
  const p = data.projects?.[id]

  const [editTask, setEditTask] = useState<{ id?: string } | null>(null)
  const [taskTitle, setTaskTitle] = useState('')
  const [taskAssignee, setTaskAssignee] = useState('')
  const [taskHours, setTaskHours] = useState('')
  const [taskDue, setTaskDue] = useState('')
  const [taskBillable, setTaskBillable] = useState(true)

  const [starting, setStarting] = useState(false)
  const [startTask, setStartTask] = useState('')
  const [startBillable, setStartBillable] = useState(true)
  const [startNote, setStartNote] = useState('')

  const [editEntry, setEditEntry] = useState<{ id?: string } | null>(null)
  const [entryDate, setEntryDate] = useState('')
  const [entryMin, setEntryMin] = useState('')
  const [entryTask, setEntryTask] = useState('')
  const [entryBillable, setEntryBillable] = useState(true)
  const [entryNote, setEntryNote] = useState('')

  const [billing, setBilling] = useState(false)
  const [mode, setMode] = useState<Mode>('cash')
  const [invoicing, setInvoicing] = useState(false)
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')

  const team = useTeam()
  if (!can) return <Denied title="Project" who="Projects are for people who work at the counter." />
  if (!p) return <Screen title="Not found" back><T tone="mute">This project is no longer here.</T></Screen>
  const summary = projectSummary(data, p, now)
  const tasks = tasksOf(data, p.id)
  const entries = entriesOf(data, p.id).slice(0, 30)
  const mine = runningTimer(data, me?.id ?? '')
  const myTimerHere = mine?.projectId === p.id ? mine : undefined
  const hasDue = paymentMethodList().some((m) => m.id === 'due') && !!p.customerId

  function startTask_() { setTaskTitle(''); setTaskAssignee(''); setTaskHours(''); setTaskDue(''); setTaskBillable(true); setEditTask({}) }
  function openTask(t: ProjectTask) { setTaskTitle(t.title); setTaskAssignee(t.assigneeId ?? ''); setTaskHours(String(t.estHours)); setTaskDue(t.dueDate ? dayText(t.dueDate) : ''); setTaskBillable(t.billable); setEditTask({ id: t.id }) }
  function saveTask_() {
    const r = act((s, ctx) => saveTask(s, p!.id, { title: taskTitle, estHours: Number(taskHours) || 0, billable: taskBillable, ...(taskAssignee ? { assigneeId: taskAssignee } : {}), ...(dayValue(taskDue) !== undefined ? { dueDate: dayValue(taskDue) } : {}) }, editTask?.id, ctx), 'Saved')
    if (r) setEditTask(null)
  }
  async function deleteTask_() {
    if (!editTask?.id) return
    if (await ask({ title: 'Delete this task?', confirm: 'Delete', danger: true }) && act((s, ctx) => deleteTask(s, editTask!.id!, ctx), 'Deleted')) setEditTask(null)
  }

  function doStart() { if (act((s, ctx) => startTimer(s, { projectId: p!.id, billable: startBillable, note: startNote, ...(startTask ? { taskId: startTask } : {}) }, ctx), 'Timer started')) setStarting(false) }
  function doStop(entryId: string) { act((s, ctx) => stopTimer(s, entryId, ctx), 'Timer stopped') }

  function openNewEntry() { setEntryDate(dayText(now)); setEntryMin(''); setEntryTask(''); setEntryBillable(true); setEntryNote(''); setEditEntry({}) }
  function openEntry(e: TimeEntry) { setEntryDate(dayText(e.date)); setEntryMin(String(e.minutes)); setEntryTask(e.taskId ?? ''); setEntryBillable(e.billable); setEntryNote(e.note); setEditEntry({ id: e.id }) }
  function saveEntry() {
    const date = dayValue(entryDate) ?? now
    const r = editEntry?.id
      ? act((s, ctx) => editTime(s, editEntry.id!, { minutes: Number(entryMin) || 0, billable: entryBillable, note: entryNote, date, ...(entryTask ? { taskId: entryTask } : {}) }, ctx), 'Saved')
      : act((s, ctx) => logTime(s, { projectId: p!.id, minutes: Number(entryMin) || 0, billable: entryBillable, note: entryNote, date, ...(entryTask ? { taskId: entryTask } : {}) }, ctx), 'Time logged')
    if (r) setEditEntry(null)
  }
  async function deleteEntry() {
    if (!editEntry?.id) return
    if (await ask({ title: 'Delete this entry?', confirm: 'Delete', danger: true }) && act((s, ctx) => deleteTime(s, editEntry!.id!, ctx), 'Deleted')) setEditEntry(null)
  }

  function billHours() {
    const r = act((s, ctx) => invoiceTimesheet(s, p!.id, [{ mode, amount: summary.unbilledAmount }], ctx), 'Billed')
    if (r) { setBilling(false); router.push({ pathname: '/bills/[id]', params: { id: r.bill.id } } as never) }
  }
  function invoiceFee() {
    const r = act((s, ctx) => invoiceFixedFee(s, p!.id, Number(amount) || 0, label, [{ mode, amount: Number(amount) || 0 }], ctx), 'Billed')
    if (r) { setInvoicing(false); router.push({ pathname: '/bills/[id]', params: { id: r.bill.id } } as never) }
  }

  return (
    <Screen title={p.name} subtitle={p.no} back
      right={<Button label="Edit" kind="soft" size="sm" icon={<Pencil size={15} color={c.primary} />} onPress={() => router.push({ pathname: '/m/services/projects/new', params: { id: p.id } })} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Badge tone={STATUS_TONE[p.status]}>{PROJECT_LABEL[p.status]}</Badge></View>
          <View style={{ marginTop: 8 }}>
            <KV k="Customer" v={p.customerId ? data.customers[p.customerId]?.name ?? '—' : 'None'} />
            <KV k="Billing" v={p.billing === 'hourly' ? `Hourly · ${inr(p.hourlyRate, 0)}/h` : `Fixed fee · ${inr(p.fixedAmount, 0)}`} />
            <KV k="Hours worked" v={`${summary.hours} h`} />
            {p.budgetHours > 0 ? <KV k="Budget" v={`${summary.budgetPct}% of ${p.budgetHours} h`} /> : null}
            {p.budgetHours > 0 ? <ProgressBar value={(summary.budgetPct ?? 0) / 100} tone={(summary.budgetPct ?? 0) > 100 ? 'danger' : 'primary'} /> : null}
            {p.startDate ? <KV k="Start" v={fmtDate(p.startDate)} /> : null}
            {p.dueDate ? <KV k="Due" v={fmtDate(p.dueDate)} /> : null}
            {p.notes ? <KV k="Notes" v={p.notes} /> : null}
          </View>
        </Card>

        {p.status !== 'cancelled' ? (
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {(['active', 'on_hold', 'completed'] as ProjectStatus[]).filter((s) => s !== p.status).map((s) => (
              <Chip key={s} label={PROJECT_LABEL[s]} onPress={() => act((st, ctx) => setProjectStatus(st, p!.id, s, ctx))} />
            ))}
            <Chip label="Cancel" tone="danger" onPress={() => act((st, ctx) => setProjectStatus(st, p!.id, 'cancelled', ctx))} />
          </View>
        ) : null}

        <Section title="Tasks" action="Add" onAction={startTask_}>
          {tasks.length ? (
            <View style={{ gap: 10 }}>
              {tasks.map((t) => (
                <Card key={t.id} style={{ gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>{t.title}</T>
                      <T v="caption" tone="mute">{t.assigneeId ? data.users[t.assigneeId]?.name ?? '' : 'Unassigned'}{t.estHours ? ` · ${t.estHours} h est.` : ''}</T>
                    </View>
                    <Chip label={TASK_LABEL[t.status]} tone={TASK_TONE[t.status]} onPress={() => act((s, ctx) => setTaskStatus(s, t.id, TASK_NEXT[t.status], ctx))} />
                  </View>
                  <Button label="Edit" kind="ghost" size="sm" icon={<Pencil size={14} color={c.primary} />} onPress={() => openTask(t)} />
                </Card>
              ))}
            </View>
          ) : <EmptyState compact icon={<Plus size={22} color={c.primary} />} title="No tasks yet" />}
        </Section>

        <Section title="Time" style={{ marginTop: 0 }}>
          <View style={{ gap: 10 }}>
            {myTimerHere ? (
              <Card tone="warning" style={{ gap: 8 }}>
                <T v="bodyStrong">Timer running · {hoursOf(entryMinutes(myTimerHere, now))} h</T>
                {myTimerHere.note ? <T v="caption" tone="mute">{myTimerHere.note}</T> : null}
                <Button label="Stop timer" kind="dark" size="sm" icon={<Pause size={14} color="#fff" />} onPress={() => doStop(myTimerHere!.id)} />
              </Card>
            ) : mine ? (
              <Card tone="warning"><T v="caption">A timer is running on {data.projects?.[mine.projectId]?.name ?? 'another project'}. Stop it there first.</T></Card>
            ) : p.status === 'active' ? (
              <Button label="Start timer" kind="soft" icon={<Play size={16} color={c.primary} />} onPress={() => { setStartTask(''); setStartBillable(p.billing === 'hourly'); setStartNote(''); setStarting(true) }} />
            ) : null}
            <Button label="Add time manually" kind="ghost" size="sm" onPress={openNewEntry} />
            {entries.length ? (
              <Group>{entries.map((e) => (
                <ListRow key={e.id} title={`${hoursOf(entryMinutes(e, now))} h${e.taskId ? ` · ${data.projectTasks?.[e.taskId]?.title ?? ''}` : ''}`}
                  subtitle={`${fmtDate(e.date)} · ${data.users[e.userId]?.name ?? ''}${e.runningSince ? ' · running' : ''}`}
                  meta={e.billId ? 'Invoiced' : e.billable ? 'Billable' : 'Not billable'} value={e.billable ? inr(entryAmount(e, now), 0) : undefined}
                  onPress={e.runningSince ? undefined : () => openEntry(e)} />
              ))}</Group>
            ) : null}
          </View>
        </Section>

        <Section title="Billing" style={{ marginTop: 0 }}>
          {p.billing === 'hourly' ? (
            <Card style={{ gap: 10 }}>
              <KV k="Unbilled" v={`${summary.unbilledHours} h · ${inr(summary.unbilledAmount, 0)}`} strong />
              <Button label="Bill unbilled hours" disabled={!summary.unbilledAmount} icon={<ReceiptText size={16} color={c.onPrimary} />} onPress={() => { setMode('cash'); setBilling(true) }} />
            </Card>
          ) : (
            <Card style={{ gap: 10 }}>
              <KV k="Invoiced so far" v={inr(p.fixedInvoiced, 0)} />
              <KV k="Left to invoice" v={inr(summary.fixedLeft, 0)} strong />
              <Button label="Invoice an amount" disabled={!summary.fixedLeft} icon={<ReceiptText size={16} color={c.onPrimary} />} onPress={() => { setAmount(String(summary.fixedLeft)); setLabel(''); setMode('cash'); setInvoicing(true) }} />
            </Card>
          )}
        </Section>

        {p.customerId ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: p.customerId as string } } as never)} /> : null}
      </View>

      <Sheet visible={!!editTask} onClose={() => setEditTask(null)} full title={editTask?.id ? 'Edit task' : 'New task'}
        footer={<View style={{ gap: 10 }}><Button label="Save" size="lg" block onPress={saveTask_} />{editTask?.id ? <Button label="Delete" kind="outline" block onPress={() => void deleteTask_()} /> : null}</View>}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Field label="Title" value={taskTitle} onChangeText={setTaskTitle} autoCapitalize="sentences" />
          <Select label="Assignee (optional)" value={taskAssignee} placeholder="Unassigned" options={[{ value: '', label: 'Unassigned' }, ...team.map((u) => ({ value: u.id, label: u.name }))]} onChange={setTaskAssignee} />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <NumberField containerStyle={{ flex: 1 }} label="Estimated hours" value={taskHours} onChange={setTaskHours} decimals />
            <View style={{ flex: 1 }}><DateField label="Due (optional)" value={taskDue} onChange={setTaskDue} /></View>
          </View>
          <SwitchRow title="Billable" subtitle="Time logged on this task can be invoiced" value={taskBillable} onChange={setTaskBillable} />
        </View>
      </Sheet>

      <Sheet visible={starting} onClose={() => setStarting(false)} title="Start the timer" footer={<Button label="Start" size="lg" block onPress={doStart} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          {tasks.length ? <Select label="Task (optional)" value={startTask} placeholder="None" options={[{ value: '', label: 'None' }, ...tasks.map((t) => ({ value: t.id, label: t.title }))]} onChange={setStartTask} /> : null}
          <SwitchRow title="Billable" value={startBillable} onChange={setStartBillable} />
          <Field label="Note (optional)" value={startNote} onChangeText={setStartNote} />
        </View>
      </Sheet>

      <Sheet visible={!!editEntry} onClose={() => setEditEntry(null)} full title={editEntry?.id ? 'Edit time' : 'Add time'}
        footer={<View style={{ gap: 10 }}><Button label="Save" size="lg" block onPress={saveEntry} />{editEntry?.id ? <Button label="Delete" kind="outline" block icon={<Trash size={16} color={c.ink} />} onPress={() => void deleteEntry()} /> : null}</View>}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <DateField label="Date" value={entryDate} onChange={setEntryDate} />
          <NumberField label="Minutes" value={entryMin} onChange={setEntryMin} />
          {tasks.length ? <Select label="Task (optional)" value={entryTask} placeholder="None" options={[{ value: '', label: 'None' }, ...tasks.map((t) => ({ value: t.id, label: t.title }))]} onChange={setEntryTask} /> : null}
          <SwitchRow title="Billable" value={entryBillable} onChange={setEntryBillable} disabled={p.billing !== 'hourly'} />
          <Field label="Note (optional)" value={entryNote} onChangeText={setEntryNote} />
        </View>
      </Sheet>

      <Sheet visible={billing} onClose={() => setBilling(false)} title={`Bill ${inr(summary.unbilledAmount, 0)}`} footer={<Button label="Bill it" size="lg" block onPress={billHours} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, ...(hasDue ? [{ value: 'due' as const, label: 'On account' }] : [])]} />
          <T v="caption" tone="mute">Every billable hour not yet invoiced goes on one bill.</T>
        </View>
      </Sheet>

      <Sheet visible={invoicing} onClose={() => setInvoicing(false)} title="Invoice an amount" footer={<Button label="Bill it" size="lg" block onPress={invoiceFee} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <MoneyField label="Amount" value={amount} onChange={setAmount} hint={`Up to ${inr(summary.fixedLeft, 0)} left on this project.`} />
          <Field label="Label (optional)" value={label} onChangeText={setLabel} placeholder="Advance, milestone 1…" />
          <Segmented value={mode} onChange={setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'upi', label: 'UPI' }, { value: 'card', label: 'Card' }, ...(hasDue ? [{ value: 'due' as const, label: 'On account' }] : [])]} />
        </View>
      </Sheet>
    </Screen>
  )
}
