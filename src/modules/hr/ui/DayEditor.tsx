import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Chip } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { clockOf, labelDayWeek } from '../logic/ymd'
import { clearMark, markAttendance, requestRegularisation } from '../ops'
import type { Employee, MarkStatus, YMD } from '../types'
import { act, useHr } from './common'

/**
 * One day of one person. A manager marks it (present, half, absent, with times) or removes a mark; a member of staff asks for it
 * to be fixed, and the manager decides.
 */
export function DayEditor({ employee, date, mode, visible, onClose }: { employee: Employee; date: YMD; mode: 'mark' | 'request'; visible: boolean; onClose: () => void }) {
  const { data } = useHr()
  const mark = data.attendance?.[`${employee.id}_${date}`]
  const [status, setStatus] = useState<MarkStatus>('present')
  const [inTime, setInTime] = useState('')
  const [outTime, setOutTime] = useState('')
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (!visible) return
    setStatus(mark?.status ?? 'present'); setInTime(mark?.inAt ? clockOf(mark.inAt) : ''); setOutTime(mark?.outAt ? clockOf(mark.outAt) : ''); setReason(mark?.reason ?? '')
  }, [visible, mark])

  function save() {
    const r = mode === 'mark'
      ? act((s, ctx) => markAttendance(s, { employeeId: employee.id, date, status, inTime, outTime, reason }, ctx), 'Marked')
      : act((s, ctx) => requestRegularisation(s, { employeeId: employee.id, date, inTime, outTime, reason }, ctx), 'Request sent')
    if (r) onClose()
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={mode === 'mark' ? 'Mark the day' : 'Ask to fix this day'} subtitle={`${employee.name} · ${labelDayWeek(date)}`}
      footer={(
        <View style={{ padding: 16, gap: 10 }}>
          <Button label={mode === 'mark' ? 'Save mark' : 'Send request'} size="lg" block onPress={save} />
          {mode === 'mark' && mark ? <Button label="Remove the mark" kind="outline" block onPress={() => { if (act((s, ctx) => clearMark(s, employee.id, date, ctx), 'Mark removed')) onClose() }} /> : null}
        </View>
      )}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        {mode === 'mark' ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([['present', 'Present'], ['half', 'Half day'], ['absent', 'Absent']] as const).map(([v, l]) => <Chip key={v} label={l} selected={status === v} onPress={() => setStatus(v)} />)}
          </View>
        ) : <T tone="mute">Say when you came in or went out. Your manager will approve it and the day counts as present.</T>}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Field containerStyle={{ flex: 1 }} label="In (HH:MM)" value={inTime} onChangeText={setInTime} placeholder="09:30" autoCapitalize="none" />
          <Field containerStyle={{ flex: 1 }} label="Out (HH:MM)" value={outTime} onChangeText={setOutTime} placeholder="18:00" autoCapitalize="none" />
        </View>
        <Field label={mode === 'mark' ? 'Reason (optional)' : 'What happened'} value={reason} onChangeText={setReason} placeholder={mode === 'mark' ? '' : 'Forgot to punch, phone was off…'} />
      </View>
    </Sheet>
  )
}
