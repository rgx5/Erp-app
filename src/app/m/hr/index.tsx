import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { dayBoard } from '@/modules/hr/logic/select'
import { payrollPreview, payrollTotals } from '@/modules/hr/logic/payroll'
import { waitingApprovals } from '@/modules/hr/notices'
import { labelYM, ymOf, ymdOf } from '@/modules/hr/logic/ymd'
import { useHr } from '@/modules/hr/ui/common'
import { PunchCard } from '@/modules/hr/ui/PunchCard'
import { moduleById } from '@/modules/registry'
import { Screen } from '@/ui/Screen'
import { ListRow, Notice, Section, StatTile } from '@/ui/blocks'
import { Group } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { CalendarCheck, Clock, Users, WalletCards } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { can as roleCan } from '@/domain/permissions'
import { useUser } from '@/data/store'

/** People & payroll: today at a glance, and the way into each part. */
export default function HrHome() {
  const { c } = useTheme()
  const router = useRouter()
  const isHr = useCan('hr')
  const isPayroll = useCan('payroll')
  const isSelf = useCan('hrSelf')
  const user = useUser()
  const { data, idx, me, now } = useHr()
  const today = ymdOf(now)
  const month = ymOf(now)

  const board = useMemo(() => (isHr ? dayBoard(data, idx, today, now) : []), [isHr, data, idx, today, now])
  const present = board.filter((b) => b.info.presentFrac > 0).length
  const waiting = useMemo(() => waitingApprovals(data), [data])
  const totals = useMemo(() => (isPayroll ? payrollTotals(payrollPreview(data, month, now)) : null), [isPayroll, data, month, now])
  const features = (moduleById('hr')?.features ?? []).filter((f) => !f.perm || roleCan(user?.role, f.perm))

  if (!isSelf && !isHr && !isPayroll) return <Screen title="People & payroll" back><T tone="mute">People and payroll are for the owner, managers and staff with an employee profile.</T></Screen>

  const sections = [...new Set(features.map((f) => f.section ?? 'More'))]
  return (
    <Screen title="People & payroll" back>
      <View style={{ gap: 16, paddingBottom: 24 }}>
        {me ? <PunchCard employee={me} title="My attendance" /> : isSelf && !isHr ? <Notice tone="primary" title="You are not on the staff list yet" body="Ask the owner to add you as an employee and link your sign-in, then you can punch in here, ask for leave and claim expenses." /> : null}
        {isHr ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <StatTile label="In today" value={`${present}/${board.length}`} icon={<Clock size={18} color={c.success} />} tone="success" onPress={() => router.push('/m/hr/attendance')} />
            <StatTile label="Waiting" value={String(waiting.total)} icon={<CalendarCheck size={18} color={waiting.total ? c.warning : c.success} />} tone={waiting.total ? 'warning' : 'success'} foot="leave, claims, fixes" onPress={() => router.push('/m/hr/leave')} />
          </View>
        ) : null}
        {isPayroll && totals ? (
          <StatTile label={`${labelYM(month)} payroll`} value={inr(totals.net, 0)} icon={<WalletCards size={18} color={c.primary} />} foot={totals.people ? `${totals.people} people · cost to business ${inr(totals.cost, 0)}` : 'No pay terms set up yet'} onPress={() => router.push('/m/hr/payroll')} style={{ flex: undefined }} />
        ) : null}
        {isHr && !board.length ? <Notice tone="primary" icon={<Users size={18} color={c.primary} />} title="Add your first employee" body="Profiles, pay terms, shifts and leave all start from the employee list." action="Add employee" onAction={() => router.push('/m/hr/employees/edit')} /> : null}
        {sections.map((sec) => (
          <Section key={sec} title={sec} style={{ marginTop: 0 }}>
            <Group>
              {features.filter((f) => (f.section ?? 'More') === sec).map((f) => {
                const Icon = f.icon
                const badge = f.badge?.(data)
                return <ListRow key={f.id} icon={<Icon size={20} color={c.primary} />} iconTone={f.tone} title={f.label} subtitle={f.sub} value={badge ? String(badge) : undefined} valueTone="warning" onPress={() => router.push(f.to as never)} />
              })}
            </Group>
          </Section>
        ))}
      </View>
    </Screen>
  )
}
