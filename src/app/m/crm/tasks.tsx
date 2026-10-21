import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Chip, Group } from '@/ui/primitives'
import { EmptyState, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ListTodo, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { taskCounts, taskState, type TaskState } from '@/modules/crm/tasks'
import { TaskRow, TaskSheet } from '@/modules/crm/ui/Work'

const TABS: Array<{ id: 'todo' | 'done'; label: string }> = [{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }]
const GROUPS: Array<{ state: TaskState; title: string }> = [
  { state: 'overdue', title: 'Late' }, { state: 'today', title: 'Today' }, { state: 'upcoming', title: 'Coming up' }, { state: 'someday', title: 'No date' },
]

/** Everyone's tasks and reminders in the order to do them. */
export default function Tasks() {
  const { c } = useTheme()
  const can = useCan('customers')
  const tasks = useApp((s) => s.data.crmTasks)
  const [tab, setTab] = useState<'todo' | 'done'>('todo')
  const [adding, setAdding] = useState(false)
  const now = Date.now()
  const counts = useMemo(() => taskCounts({ crmTasks: tasks }, now), [tasks, now])
  const list = useMemo(() => listOf(tasks ?? {}), [tasks])

  if (!can) return <Screen title="Tasks" back><T tone="mute">Tasks are for people who use the billing counter.</T></Screen>
  const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 50)
  return (
    <Screen title="Tasks & reminders" subtitle={`${counts.overdue + counts.today} due`} back right={<IconButton label="New task" tone="dark" onPress={() => setAdding(true)}><Plus size={22} color={c.bg} /></IconButton>}>
      <View style={{ gap: 12, paddingBottom: 24 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>{TABS.map((t) => <Chip key={t.id} label={t.label} selected={tab === t.id} onPress={() => setTab(t.id)} count={t.id === 'done' ? counts.done : counts.overdue + counts.today + counts.upcoming + counts.someday} />)}</View>
        {tab === 'todo' ? (
          GROUPS.map((g) => {
            const rows = list.filter((t) => taskState(t, now) === g.state).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity))
            return rows.length ? <Section key={g.state} title={g.title} style={{ marginTop: 6 }}><Group>{rows.map((t) => <TaskRow key={t.id} task={t} />)}</Group></Section> : null
          })
        ) : done.length ? <Group>{done.map((t) => <TaskRow key={t.id} task={t} />)}</Group> : null}
        {tab === 'todo' && !counts.overdue && !counts.today && !counts.upcoming && !counts.someday ? (
          <EmptyState icon={<ListTodo size={26} color={c.primary} />} title="All clear" hint="Add a reminder to call a customer back, deliver an order or chase a payment." action="New task" onAction={() => setAdding(true)} />
        ) : null}
      </View>
      <TaskSheet visible={adding} onClose={() => setAdding(false)} target={{}} />
    </Screen>
  )
}
