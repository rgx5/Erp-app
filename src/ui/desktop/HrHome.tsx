import React, { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { can as roleCan } from '@/domain/permissions'
import { inr } from '@/domain/money'
import { useCan, useUser } from '@/data/store'
import { dayBoard } from '@/modules/hr/logic/select'
import { payrollPreview, payrollTotals } from '@/modules/hr/logic/payroll'
import { waitingApprovals } from '@/modules/hr/notices'
import { labelYM, ymOf, ymdOf } from '@/modules/hr/logic/ymd'
import { useHr } from '@/modules/hr/ui/common'
import { PunchCard } from '@/modules/hr/ui/PunchCard'
import { moduleById, type FeatureEntry } from '@/modules/registry'
import { T } from '@/ui/Text'
import { toneColor, toneTint, useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, KpiStrip, KpiTile, Toolbar, dtext } from './kit'

/**
 * The desktop People & payroll hub: the same headline numbers as the phone screen's `StatTile`s, as a `KpiStrip`,
 * then the exact feature list (`moduleById('hr').features`, filtered by role and grouped by `section`) as a
 * wrapping card grid — the same "module hub" treatment `DesktopWarehouseHome` gives the warehouse module. Reads
 * its own data directly (`useHr`, `useCan`), exactly like that screen: nothing is passed down from the phone route,
 * which keeps its body (`src/app/m/hr/index.tsx`) completely unchanged.
 */
export function DesktopHrHome() {
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

  if (!isSelf && !isHr && !isPayroll) {
    return (
      <DeskPage toolbar={<Toolbar title="People & payroll" />}>
        <View style={{ padding: 20 }}><T tone="mute">People and payroll are for the owner, managers and staff with an employee profile.</T></View>
      </DeskPage>
    )
  }

  const sections = [...new Set(features.map((f) => f.section ?? 'More'))]

  return (
    <DeskPage toolbar={<Toolbar title="People & payroll" />}>
      {isHr ? (
        <KpiStrip>
          <KpiTile label="In today" value={`${present}/${board.length}`} tone="success" delta="present now" onPress={() => router.push('/m/hr/attendance')} />
          <KpiTile label="Waiting" value={String(waiting.total)} tone={waiting.total ? 'warning' : 'success'} delta="leave, claims, fixes" onPress={() => router.push('/m/hr/leave')} />
          {isPayroll && totals ? <KpiTile label={`${labelYM(month)} payroll`} value={inr(totals.net, 0)} tone="primary" delta={totals.people ? `${totals.people} people · cost ${inr(totals.cost, 0)}` : 'No pay terms set up yet'} onPress={() => router.push('/m/hr/payroll')} /> : null}
        </KpiStrip>
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 20 }}>
        {me ? <View style={{ maxWidth: 420 }}><PunchCard employee={me} title="My attendance" /></View> : isSelf && !isHr ? (
          <T tone="mute">You are not on the staff list yet. Ask the owner to add you as an employee and link your sign-in, then you can punch in here, ask for leave and claim expenses.</T>
        ) : null}

        {isHr && !board.length ? (
          <DeskButton label="Add your first employee" tone="primary" onPress={() => router.push('/m/hr/employees/edit')} />
        ) : null}

        {sections.map((sec) => (
          <View key={sec} style={{ gap: 10 }}>
            <T style={[dtext.label, { color: c.inkMute }]}>{sec}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {features.filter((f) => (f.section ?? 'More') === sec).map((f) => (
                <FeatureCard key={f.id} feature={f} badge={f.badge?.(data)} onOpen={(to) => router.push(to as never)} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </DeskPage>
  )
}

function FeatureCard({ feature: f, badge, onOpen }: { feature: FeatureEntry; badge?: number | null; onOpen: (to: string) => void }) {
  const { c } = useTheme()
  const [hovered, setHovered] = useState(false)
  const Icon = f.icon
  return (
    <Pressable
      onPress={() => onOpen(f.to)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        minWidth: 260, maxWidth: 360, flexGrow: 1, flexBasis: 260,
        flexDirection: 'row', alignItems: 'flex-start', gap: 12,
        padding: 14, backgroundColor: hovered ? c.sunken : c.surface,
        borderWidth: 1, borderColor: hovered ? c.lineStrong : c.line, borderRadius: 8,
      }}
    >
      <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: toneTint(c, f.tone), alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={18} color={toneColor(c, f.tone)} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{f.label}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={2}>{f.sub}</T>
      </View>
      {badge ? <T style={[dtext.tiny, { color: c.warning }]}>{String(badge)}</T> : null}
    </Pressable>
  )
}
