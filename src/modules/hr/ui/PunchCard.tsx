import React, { useState } from 'react'
import { View } from 'react-native'
import { fmtTime } from '@/domain/dates'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Card } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { Clock, MapPin } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { hrSettings } from '../logic/settings'
import { ymdOf } from '../logic/ymd'
import { punch } from '../ops'
import type { Employee } from '../types'
import { act, useHr } from './common'

/** Punch in / out for one person. The place is a note in words — no location permission is needed. */
export function PunchCard({ employee, title }: { employee: Employee; title?: string }) {
  const { c } = useTheme()
  const { data, now } = useHr()
  const [geo, setGeo] = useState('')
  const [busy, setBusy] = useState(false)
  const settings = hrSettings(data)
  const mine = Object.values(data.punches ?? {}).filter((p) => p.employeeId === employee.id).sort((a, b) => b.at - a.at)
  const last = mine[0]
  const open = !!last && last.kind === 'in' && now - last.at < 20 * 3_600_000
  const today = ymdOf(now)
  const todays = mine.filter((p) => p.date === today).sort((a, b) => a.at - b.at)

  function go() {
    if (busy) return
    setBusy(true)
    const r = act((s, ctx) => punch(s, employee.id, { geo }, ctx), undefined)
    setBusy(false)
    if (r) { setGeo(''); }
  }
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Clock size={20} color={c.primary} />
        <View style={{ flex: 1 }}>
          <T v="title">{title ?? employee.name}</T>
          <T v="caption" tone="mute">{open ? `In since ${fmtTime(last.at)}` : todays.length ? `Out at ${fmtTime(todays[todays.length - 1].at)}` : 'Not in yet today'}</T>
        </View>
      </View>
      <Field value={geo} onChangeText={setGeo} placeholder={settings.requireGeoNote ? 'Where are you? (required)' : 'Where are you? (optional)'} left={<MapPin size={16} color={c.inkMute} />} hint={settings.geoNote || undefined} />
      <Button label={open ? 'Punch out' : 'Punch in'} kind={open ? 'dark' : 'primary'} size="lg" block loading={busy} onPress={go} />
      {todays.length ? <T v="caption" tone="mute">{todays.map((p) => `${p.kind === 'in' ? 'In' : 'Out'} ${fmtTime(p.at)}`).join(' · ')}</T> : null}
    </Card>
  )
}
