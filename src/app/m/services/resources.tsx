import React, { useState } from 'react'
import { View } from 'react-native'
import { useCan, useApp } from '@/data/store'
import { listOf } from '@/data/state'
import { ask } from '@/ui/overlays'
import { Button } from '@/ui/Button'
import { Field, Segmented, Select, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Chip, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, UserRound } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { settingsOf } from '@/modules/services/logic/settings'
import { deleteResource, saveResource } from '@/modules/services/ops'
import type { ResourceKind, ServiceResource } from '@/modules/services/types'
import { act, Denied, TimeField, useTeam, useVariantChoices } from '@/modules/services/ui/common'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The columns of the calendar: staff and resources, with their own hours, days off and the services they do. */
export default function Resources() {
  const { c } = useTheme()
  const can = useCan('servicesManage')
  const data = useApp((s) => s.data)
  const team = useTeam()
  const services = useVariantChoices('service')
  const cfg = settingsOf(data)
  const [edit, setEdit] = useState<{ id?: string } | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ResourceKind>('staff')
  const [userId, setUserId] = useState('')
  const [phone, setPhone] = useState('')
  const [own, setOwn] = useState(false)
  const [open, setOpen] = useState(cfg.openTime)
  const [close, setClose] = useState(cfg.closeTime)
  const [days, setDays] = useState<number[]>(cfg.workDays)
  const [off, setOff] = useState('')
  const [only, setOnly] = useState<string[]>([])
  const [active, setActive] = useState(true)
  const rows = listOf(data.serviceResources ?? {}).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))

  if (!can) return <Denied title="Staff & resources" who="Staff and resources are set up by the owner or a manager." />
  function start(r?: ServiceResource) {
    setName(r?.name ?? ''); setKind(r?.kind ?? 'staff'); setUserId(r?.userId ?? ''); setPhone(r?.phone ?? ''); setOwn(!!(r?.openTime || r?.workDays?.length))
    setOpen(r?.openTime ?? cfg.openTime); setClose(r?.closeTime ?? cfg.closeTime); setDays(r?.workDays?.length ? r.workDays : cfg.workDays); setOff((r?.daysOff ?? []).join(', ')); setOnly(r?.variantIds ?? []); setActive(r?.active ?? true)
    setEdit({ id: r?.id })
  }
  function save() {
    const r = act((s, ctx) => saveResource(s, {
      name, kind, ...(userId ? { userId } : {}), phone, ...(own ? { openTime: open, closeTime: close, workDays: days } : {}),
      daysOff: off.split(/[,\s]+/).filter(Boolean), variantIds: only, active,
    }, edit?.id, ctx), 'Saved')
    if (r) setEdit(null)
  }

  return (
    <Screen title="Staff & resources" subtitle="The columns of your calendar" back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Button label="Add a column" kind="soft" icon={<Plus size={18} color={c.primary} />} onPress={() => start()} />
        {rows.length ? (
          <Group>{rows.map((r) => (
            <ListRow key={r.id} avatar={r.name} title={r.name} subtitle={`${r.kind === 'staff' ? 'Staff' : 'Resource'}${r.active ? '' : ' · off'}${r.variantIds.length ? ` · ${r.variantIds.length} services` : ' · everything'}`}
              meta={r.openTime ? `${r.openTime}–${r.closeTime}` : undefined} onPress={() => start(r)} />
          ))}</Group>
        ) : <EmptyState icon={<UserRound size={26} color={c.primary} />} title="Add your first column" hint="A stylist, a technician, a chair, a room or a bay. Each one gets a column on the calendar and is booked on its own." />}
      </View>

      <Sheet visible={!!edit} onClose={() => setEdit(null)} full title={edit?.id ? 'Edit column' : 'New column'}
        footer={(
          <View style={{ padding: 16, gap: 10 }}>
            <Button label="Save" size="lg" block onPress={save} />
            {edit?.id ? <Button label="Delete" kind="outline" block onPress={async () => { if (await ask({ title: 'Delete this column?', message: 'Only possible when nothing was ever booked on it.', confirm: 'Delete', cancel: 'Keep' }) && act((s, ctx) => deleteResource(s, edit.id!, ctx), 'Deleted')) setEdit(null) }} /> : null}
          </View>
        )}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <Segmented value={kind} onChange={setKind} options={[{ value: 'staff', label: 'Staff' }, { value: 'resource', label: 'Chair / room / bay' }]} />
          <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
          {kind === 'staff' ? <Select label="Their login (optional)" value={userId} placeholder="None" options={[{ value: '', label: 'None' }, ...team.map((u) => ({ value: u.id, label: u.name }))]} onChange={setUserId} /> : null}
          {kind === 'staff' ? <Field label="Mobile (optional)" value={phone} onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" /> : null}
          <SwitchRow title="Own working hours" subtitle={`Otherwise the shop's ${cfg.openTime}–${cfg.closeTime}`} value={own} onChange={setOwn} />
          {own ? (
            <View style={{ gap: 12 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><TimeField label="Opens" value={open} onChange={setOpen} /></View>
                <View style={{ flex: 1 }}><TimeField label="Closes" value={close} onChange={setClose} /></View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {DAYS.map((d, i) => <Chip key={d} label={d} selected={days.includes(i)} onPress={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])} />)}
              </View>
            </View>
          ) : null}
          <Field label="Days off (optional)" value={off} onChangeText={setOff} placeholder="2026-11-14, 2026-11-15" hint="Leave or holidays, as year-month-day, separated by commas." />
          <View style={{ gap: 8 }}>
            <T v="label" tone="soft">DOES</T>
            <T v="caption" tone="mute">{only.length ? 'Only the services ticked below.' : 'Every service (tick some to limit it).'}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {services.map((sv) => <Chip key={sv.value} label={sv.label} selected={only.includes(sv.value)} onPress={() => setOnly(only.includes(sv.value) ? only.filter((x) => x !== sv.value) : [...only, sv.value])} />)}
            </View>
          </View>
          <SwitchRow title="In use" subtitle="Switch off for someone who has left" value={active} onChange={setActive} />
        </View>
      </Sheet>
    </Screen>
  )
}
