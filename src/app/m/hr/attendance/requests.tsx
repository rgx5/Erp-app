import React, { useMemo } from 'react'
import { View } from 'react-native'
import { fmtTime } from '@/domain/dates'
import { useCan } from '@/data/store'
import { decisionsByRef, statusOf } from '@/modules/hr/logic/decisions'
import { labelDayWeek } from '@/modules/hr/logic/ymd'
import { decideRegularisation } from '@/modules/hr/ops'
import { act, Denied, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { ClipboardCheck } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Requests to fix a day's attendance: approve (the day counts as present) or reject. */
export default function RegularisationRequests() {
  const { c } = useTheme()
  const isHr = useCan('hr')
  const isSelf = useCan('hrSelf')
  const { data, me } = useHr()
  const rows = useMemo(() => {
    const by = decisionsByRef(data)
    return Object.values(data.regularisations ?? {}).map((r) => ({ r, status: statusOf(by.get(r.id)) })).filter((x) => isHr || x.r.employeeId === me?.id).sort((a, b) => b.r.requestedAt - a.r.requestedAt)
  }, [data, isHr, me?.id])

  if (!isHr && !isSelf) return <Denied title="Fix requests" who="Attendance is for staff and managers." />
  return (
    <Screen title="Attendance fixes" back>
      <View style={{ gap: 10, paddingBottom: 24 }}>
        {rows.length ? rows.map(({ r, status }) => (
          <Card key={r.id} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T v="bodyStrong" style={{ flex: 1 }}>{data.employees?.[r.employeeId]?.name ?? 'Former staff'}</T>
              <Badge tone={status === 'approved' ? 'success' : status === 'pending' ? 'warning' : 'default'}>{status === 'pending' ? 'Waiting' : status === 'approved' ? 'Approved' : 'Rejected'}</Badge>
            </View>
            <T v="caption" tone="mute">{labelDayWeek(r.date)}{r.inAt ? ` · In ${fmtTime(r.inAt)}` : ''}{r.outAt ? ` · Out ${fmtTime(r.outAt)}` : ''}</T>
            <T>{r.reason}</T>
            {isHr && status === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}><Button label="Reject" kind="outline" block onPress={() => act((s, ctx) => decideRegularisation(s, r.id, 'rejected', '', ctx), 'Rejected')} /></View>
                <View style={{ flex: 1 }}><Button label="Approve" block onPress={() => act((s, ctx) => decideRegularisation(s, r.id, 'approved', '', ctx), 'Approved')} /></View>
              </View>
            ) : null}
          </Card>
        )) : <EmptyState icon={<ClipboardCheck size={26} color={c.primary} />} title="Nothing waiting" hint="When someone forgets to punch, they can ask for the day to be fixed from their month view." />}
      </View>
    </Screen>
  )
}
