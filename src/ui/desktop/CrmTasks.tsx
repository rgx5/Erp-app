import React, { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { taskCounts, taskState, type TaskState } from '@/modules/crm/tasks'
import { TaskRow, TaskSheet } from '@/modules/crm/ui/Work'
import { T } from '@/ui/Text'
import { ListTodo, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, DeskSegmented, dtext, KpiStrip, KpiTile, Toolbar } from './kit'

const GROUPS: Array<{ state: TaskState; title: string }> = [
  { state: 'overdue', title: 'Late' }, { state: 'today', title: 'Today' }, { state: 'upcoming', title: 'Coming up' }, { state: 'someday', title: 'No date' },
]

/**
 * The desktop Tasks & reminders screen: a KPI strip for what's due, a To do / Done toggle, and the exact same
 * grouped `TaskRow`s as the phone screen, in bordered cards instead of stacked `Section`s — there is no sortable
 * tabular data here (just a checklist), so this keeps the grouped-list shape instead of forcing a `DataTable`.
 * Reads its own data directly, exactly like `DesktopPurchases`: every count comes from the same `taskCounts`/
 * `taskState` the phone `m/crm/tasks.tsx` calls.
 */
export function DesktopTasks() {
  const { c } = useTheme()
  const can = useCan('customers')
  const tasks = useApp((s) => s.data.crmTasks)
  const [tab, setTab] = useState<'todo' | 'done'>('todo')
  const [adding, setAdding] = useState(false)
  const now = Date.now()
  const counts = useMemo(() => taskCounts({ crmTasks: tasks }, now), [tasks, now])
  const list = useMemo(() => listOf(tasks ?? {}), [tasks])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Tasks & reminders" />}>
        <View style={{ padding: 20 }}><T tone="mute">Tasks are for people who use the billing counter.</T></View>
      </DeskPage>
    )
  }

  const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 50)

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Tasks & reminders"
          subtitle={`${counts.overdue + counts.today} due`}
          right={<DeskButton label="New task" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => setAdding(true)} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Late" value={String(counts.overdue)} tone={counts.overdue ? 'danger' : 'default'} />
        <KpiTile label="Today" value={String(counts.today)} tone={counts.today ? 'warning' : 'default'} />
        <KpiTile label="Coming up" value={String(counts.upcoming)} />
        <KpiTile label="Done" value={String(counts.done)} tone="success" />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented value={tab} onChange={setTab} options={[{ id: 'todo', label: 'To do' }, { id: 'done', label: 'Done' }]} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 14, gap: 14 }}>
        {tab === 'todo' ? (
          GROUPS.map((g) => {
            const rows = list.filter((t) => taskState(t, now) === g.state).sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity))
            return rows.length ? (
              <View key={g.state} style={{ gap: 8 }}>
                <T style={[dtext.label, { color: c.inkMute }]}>{g.title}</T>
                <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
                  {rows.map((t, i) => <View key={t.id} style={i ? { borderTopWidth: 1, borderTopColor: c.line } : undefined}><TaskRow task={t} /></View>)}
                </View>
              </View>
            ) : null
          })
        ) : done.length ? (
          <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            {done.map((t, i) => <View key={t.id} style={i ? { borderTopWidth: 1, borderTopColor: c.line } : undefined}><TaskRow task={t} /></View>)}
          </View>
        ) : null}
        {tab === 'todo' && !counts.overdue && !counts.today && !counts.upcoming && !counts.someday ? (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 8 }}>
            <ListTodo size={26} color={c.primary} />
            <T style={dtext.cellStrong}>All clear</T>
            <T style={[dtext.cell, { color: c.inkMute }]}>Add a reminder to call a customer back, deliver an order or chase a payment.</T>
          </View>
        ) : null}
      </ScrollView>
      <TaskSheet visible={adding} onClose={() => setAdding(false)} target={{}} />
    </DeskPage>
  )
}
