import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { DAY, fmtDateTime, fmtDayShort, startOfDay } from '@/domain/dates'
import { perform, useApp } from '@/data/store'
import { Button } from '@/ui/Button'
import { Field, Segmented } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Chip, Tap } from '@/ui/primitives'
import { EmptyState, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Check, ListTodo } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { addNote, completeTask, deleteNote, deleteTask, saveTask } from '../ops'
import { NOTE_LABEL, notesFor, TASK_LABEL, taskState, tasksFor, type TaskTarget } from '../tasks'
import type { CrmTask, NoteKind, TaskKind } from '../types'
import { DateField, dateValue, failWith } from './forms'

const DUE_TONE = { overdue: 'danger', today: 'warning', upcoming: 'default', someday: 'default', done: 'success' } as const

/** One task as a row: tick it off, or tap to see/delete. */
export function TaskRow({ task, onOpen }: { task: CrmTask; onOpen?: () => void }) {
  const { c } = useTheme()
  const state = taskState(task, Date.now())
  const who = useApp((s) => (task.customerId ? s.data.customers[task.customerId]?.name : task.leadId ? s.data.crmLeads?.[task.leadId]?.name : undefined))
  function toggle() {
    try { perform((s, ctx) => completeTask(s, task.id, !task.done, ctx)) } catch (e) { failWith(e) }
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
      <Tap onPress={toggle} accessibilityLabel={task.done ? 'Mark not done' : 'Mark done'} hitSlop={8}
        style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: task.done ? c.success : c.lineStrong, backgroundColor: task.done ? c.success : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {task.done ? <Check size={15} color="#fff" /> : null}
      </Tap>
      <Tap onPress={onOpen} style={{ flex: 1, gap: 2 }}>
        <T v="bodyStrong" numberOfLines={2} style={task.done ? { textDecorationLine: 'line-through', opacity: 0.6 } : undefined}>{task.title}</T>
        <T v="caption" tone="mute" numberOfLines={1}>{TASK_LABEL[task.kind]}{who ? ` · ${who}` : ''}</T>
      </Tap>
      {task.due !== undefined && !task.done ? <Badge tone={DUE_TONE[state]}>{state === 'overdue' ? `Late · ${fmtDayShort(task.due)}` : state === 'today' ? 'Today' : fmtDayShort(task.due)}</Badge> : null}
    </View>
  )
}

/** A form in a sheet to add a task (about a customer, lead or ticket, or about nothing in particular). */
export function TaskSheet({ visible, onClose, target }: { visible: boolean; onClose: () => void; target: TaskTarget }) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<TaskKind>('task')
  const [due, setDue] = useState('')
  const [notes, setNotes] = useState('')
  function save() {
    try {
      perform((s, ctx) => saveTask(s, { title, kind, notes, ...target, ...(dateValue(due) !== undefined ? { due: dateValue(due) } : {}) }, undefined, ctx))
      toast('Task added', 'ok'); setTitle(''); setDue(''); setNotes(''); onClose()
    } catch (e) { failWith(e) }
  }
  const quick = (days: number) => setDue(new Date(startOfDay() + days * DAY + 12 * 3_600_000).toISOString().slice(0, 10))
  return (
    <Sheet visible={visible} onClose={onClose} title="New task" footer={<Button label="Add task" size="lg" block onPress={save} />}>
      <View style={{ gap: 14, paddingBottom: 8 }}>
        <Field label="What needs doing" value={title} onChangeText={setTitle} autoCapitalize="sentences" placeholder="Call about the alteration" />
        <Segmented value={kind} onChange={setKind} options={(Object.keys(TASK_LABEL) as TaskKind[]).map((k) => ({ value: k, label: TASK_LABEL[k] }))} />
        <DateField label="Due on (optional)" value={due} onChange={setDue} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Today" onPress={() => quick(0)} /><Chip label="Tomorrow" onPress={() => quick(1)} /><Chip label="Next week" onPress={() => quick(7)} />
        </View>
        <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline autoCapitalize="sentences" />
      </View>
    </Sheet>
  )
}

/** Tasks about one customer, lead or ticket, with an add button. */
export function TasksSection({ target, title = 'Tasks & reminders' }: { target: TaskTarget; title?: string }) {
  const { c } = useTheme()
  const tasks = useApp((s) => s.data.crmTasks)
  const list = useMemo(() => tasksFor({ crmTasks: tasks }, target), [tasks, target])
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState<CrmTask | null>(null)
  function remove(t: CrmTask) {
    try { perform((s) => deleteTask(s, t.id)); setSel(null) } catch (e) { failWith(e) }
  }
  return (
    <Section title={title} action="Add" onAction={() => setOpen(true)} style={{ marginTop: 6 }}>
      {list.length ? (
        <Card padded={false}>
          {list.map((t, i) => (
            <View key={t.id} style={i ? { borderTopWidth: 1, borderTopColor: c.line } : undefined}><TaskRow task={t} onOpen={() => setSel(t)} /></View>
          ))}
        </Card>
      ) : (
        <EmptyState compact icon={<ListTodo size={24} color={c.primary} />} title="Nothing to do" hint="Add a reminder to call back or follow up." action="Add a task" onAction={() => setOpen(true)} />
      )}
      <TaskSheet visible={open} onClose={() => setOpen(false)} target={target} />
      <Sheet visible={!!sel} onClose={() => setSel(null)} title={sel?.title} subtitle={sel ? `${TASK_LABEL[sel.kind]}${sel.due ? ` · due ${fmtDayShort(sel.due)}` : ''}` : undefined}
        footer={sel ? <Button label="Delete task" kind="danger" block onPress={() => remove(sel)} /> : undefined}>
        <T tone="soft" style={{ paddingBottom: 12 }}>{sel?.notes || 'No notes.'}</T>
      </Sheet>
    </Section>
  )
}

const LOG_KINDS: NoteKind[] = ['note', 'call', 'whatsapp', 'visit']

/** Notes and the communication log of one customer, lead or ticket. */
export function NotesSection({ target, title = 'Notes & contact log' }: { target: TaskTarget; title?: string }) {
  const { c } = useTheme()
  const notes = useApp((s) => s.data.crmNotes)
  const list = useMemo(() => notesFor({ crmNotes: notes }, target), [notes, target])
  const [text, setText] = useState('')
  const [kind, setKind] = useState<NoteKind>('note')
  function add() {
    try { perform((s, ctx) => addNote(s, { text, kind, ...target }, ctx)); setText('') } catch (e) { failWith(e) }
  }
  function remove(id: string) {
    try { perform((s) => deleteNote(s, id)) } catch (e) { failWith(e) }
  }
  return (
    <Section title={title} style={{ marginTop: 6 }}>
      <Card>
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
            {LOG_KINDS.map((k) => <Chip key={k} label={NOTE_LABEL[k]} selected={kind === k} onPress={() => setKind(k)} />)}
          </View>
          <Field value={text} onChangeText={setText} multiline autoCapitalize="sentences" placeholder={kind === 'note' ? 'Prefers silk, size M…' : 'What was said?'} />
          <Button label="Save" kind="soft" size="sm" onPress={add} disabled={!text.trim()} />
        </View>
      </Card>
      {list.slice(0, 30).map((n) => (
        <Tap key={n.id} onLongPress={n.kind === 'status' ? undefined : () => remove(n.id)} style={{ paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: c.line }}>
          <T v="caption" tone="mute">{NOTE_LABEL[n.kind]} · {fmtDateTime(n.at)}</T>
          <T>{n.text}</T>
        </Tap>
      ))}
      {list.length ? <T v="caption" tone="mute" style={{ marginTop: 6 }}>Press and hold a note to delete it.</T> : null}
    </Section>
  )
}
