import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { deciding, decisionsByRef } from '@/modules/hr/logic/decisions'
import { balancesFor } from '@/modules/hr/logic/leave'
import { hrSettings } from '@/modules/hr/logic/settings'
import { labelYMD, ymdOf } from '@/modules/hr/logic/ymd'
import { decideLeave, grantLeave } from '@/modules/hr/ops'
import { act, Denied, EmployeeSelect, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Field, Segmented, Select } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { CalendarCheck, Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Leave: requests (and their answers), and what each person has left. */
export default function LeaveHome() {
  const { c } = useTheme()
  const router = useRouter()
  const isHr = useCan('hr')
  const isSelf = useCan('hrSelf')
  const { data, idx, me, now } = useHr()
  const [tab, setTab] = useState<'requests' | 'balances'>('requests')
  const [empId, setEmpId] = useState(me?.id ?? '')
  const [grant, setGrant] = useState(false)
  const [gType, setGType] = useState('')
  const [gDays, setGDays] = useState('')
  const [gReason, setGReason] = useState('')
  const by = useMemo(() => decisionsByRef(data), [data])
  const rows = useMemo(() => Object.values(data.leaveRequests ?? {}).filter((r) => isHr || r.employeeId === me?.id).sort((a, b) => b.requestedAt - a.requestedAt), [data, isHr, me?.id])
  const employees = Object.values(data.employees ?? {}).filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))
  const emp = data.employees?.[empId || me?.id || '']
  const balances = useMemo(() => (emp ? balancesFor(data, idx, emp, ymdOf(now), hrSettings(data).leaveYearStartMonth) : []), [data, idx, emp, now])

  if (!isHr && !isSelf) return <Denied title="Leave" who="Leave is for staff and managers." />
  const types = Object.values(data.leaveTypes ?? {}).filter((t) => t.active && t.paid)

  return (
    <Screen title="Leave" back right={<Button label="Ask" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => router.push('/m/hr/leave/new')} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <Segmented value={tab} options={[{ value: 'requests', label: 'Requests' }, { value: 'balances', label: 'Balances' }]} onChange={setTab} />
        {tab === 'requests' ? (
          rows.length ? rows.map((r) => {
            const st = idx.leaveStatus.get(r.id) ?? 'pending'
            const dec = deciding(by.get(r.id))
            const type = data.leaveTypes?.[r.typeId]
            return (
              <Card key={r.id} style={{ gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="bodyStrong" style={{ flex: 1 }}>{data.employees?.[r.employeeId]?.name ?? 'Former staff'}</T>
                  <Badge tone={st === 'approved' ? 'success' : st === 'pending' ? 'warning' : 'default'}>{st === 'pending' ? 'Waiting' : st === 'approved' ? 'Approved' : st === 'rejected' ? 'Rejected' : 'Cancelled'}</Badge>
                </View>
                <T v="caption" tone="mute">{r.no} · {type?.name ?? 'Leave'} · {r.days} {r.days === 1 ? 'day' : 'days'}{r.half ? ` (${r.half} half)` : ''}</T>
                <T>{r.from === r.to ? labelYMD(r.from) : `${labelYMD(r.from)} to ${labelYMD(r.to)}`}</T>
                {r.reason ? <T tone="soft">{r.reason}</T> : null}
                {dec?.note ? <T v="caption" tone="mute">“{dec.note}”</T> : null}
                {isHr && st === 'pending' ? (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}><Button label="Reject" kind="outline" block onPress={() => act((s, ctx) => decideLeave(s, r.id, 'rejected', '', ctx), 'Rejected')} /></View>
                    <View style={{ flex: 1 }}><Button label="Approve" block onPress={() => act((s, ctx) => decideLeave(s, r.id, 'approved', '', ctx), 'Approved')} /></View>
                  </View>
                ) : null}
                {isHr && st === 'approved' && r.to >= ymdOf(now) ? (
                  <Button label="Cancel leave" kind="ghost" size="sm" onPress={() => act((s, ctx) => decideLeave(s, r.id, 'cancelled', '', ctx), 'Cancelled')} />
                ) : null}
              </Card>
            )
          }) : <EmptyState icon={<CalendarCheck size={26} color={c.primary} />} title="No leave requests" hint="Staff ask for leave here; you approve or reject, and approved days show in attendance and payroll." action="Ask for leave" onAction={() => router.push('/m/hr/leave/new')} />
        ) : (
          <>
            {isHr ? <EmployeeSelect label="Person" value={empId} onChange={setEmpId} employees={employees} /> : null}
            {emp ? (
              balances.length ? <Card>{balances.map((b) => (
                <KV key={b.type.id} k={b.type.name} v={b.balance.unlimited ? `${b.balance.taken} taken` : `${b.balance.balance} left`}
                  sub={b.balance.unlimited ? 'No balance — unpaid' : `${b.balance.opening ? `${b.balance.opening} carried · ` : ''}${b.balance.accrued} earned${b.balance.granted ? ` · ${b.balance.granted > 0 ? '+' : ''}${b.balance.granted} added` : ''} · ${b.balance.taken} taken${b.balance.pending ? ` · ${b.balance.pending} waiting` : ''}`} />
              ))}</Card> : <EmptyState icon={<CalendarCheck size={26} color={c.primary} />} title="No leave types yet" hint="Set up casual, sick and earned leave first." action={isHr ? 'Leave types' : undefined} onAction={() => router.push('/m/hr/leave/types')} compact />
            ) : <T tone="mute">{isHr ? 'Choose a person.' : 'You are not on the staff list yet.'}</T>}
            {isHr ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Button label="Leave types" kind="outline" block onPress={() => router.push('/m/hr/leave/types')} /></View>
                {emp && types.length ? <View style={{ flex: 1 }}><Button label="Add / take off days" kind="outline" block onPress={() => { setGType(types[0].id); setGDays(''); setGReason(''); setGrant(true) }} /></View> : null}
              </View>
            ) : null}
          </>
        )}
      </View>
      <Sheet visible={grant} onClose={() => setGrant(false)} title="Adjust leave" subtitle={emp?.name}
        footer={<View style={{ padding: 16 }}><Button label="Save" size="lg" block onPress={() => { if (emp && act((s, ctx) => grantLeave(s, { employeeId: emp.id, typeId: gType, days: Number(gDays), date: ymdOf(now), reason: gReason }, ctx), 'Balance changed')) setGrant(false) }} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Select label="Leave type" value={gType} onChange={setGType} options={types.map((t) => ({ value: t.id, label: t.name }))} />
          <Field label="Days (negative to take off)" value={gDays} onChangeText={setGDays} keyboardType="numbers-and-punctuation" placeholder="2" />
          <Field label="Reason" value={gReason} onChangeText={setGReason} placeholder="Opening balance, comp-off for Sunday work…" />
        </View>
      </Sheet>
    </Screen>
  )
}
