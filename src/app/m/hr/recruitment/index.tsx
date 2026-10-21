import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { funnel, openingStats, STAGE_LABEL } from '@/modules/hr/logic/recruitment'
import { labelYMD } from '@/modules/hr/logic/ymd'
import type { Candidate, Opening } from '@/modules/hr/types'
import { Denied, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Chip, Tap } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Briefcase, ChevronRight, Plus, UserPlus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

/** Openings and the candidates at each stage. */
export default function Recruitment() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('hr')
  const { data } = useHr()
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const openings = Object.values(data.hrOpenings ?? {}).filter((o) => (tab === 'open' ? o.status !== 'closed' : o.status === 'closed')).sort((a, b) => b.openedOn.localeCompare(a.openedOn))
  const cands = Object.values(data.hrCandidates ?? {})

  if (!can) return <Denied title="Recruitment" who="Recruitment is for the owner and managers." />
  const byOpening = (o: Opening): Candidate[] => cands.filter((x) => x.openingId === o.id && x.stage !== 'rejected' && x.stage !== 'hired').sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <Screen title="Recruitment" back right={<Button label="Opening" size="sm" icon={<Plus size={16} color={c.onPrimary} />} onPress={() => router.push('/m/hr/recruitment/opening')} />}>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}><Chip label="Open" selected={tab === 'open'} onPress={() => setTab('open')} /><Chip label="Closed" selected={tab === 'closed'} onPress={() => setTab('closed')} /></View>
        {openings.length ? openings.map((o) => {
          const st = openingStats(data, o.id)
          const f = funnel(cands, o.id).filter((x) => x.count > 0)
          return (
            <Card key={o.id} style={{ gap: 10 }}>
              <Tap onPress={() => router.push({ pathname: '/m/hr/recruitment/opening', params: { id: o.id } } as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="title">{o.title}</T>
                  <T v="caption" tone="mute">{[o.department, o.location, `${st.hired}/${o.positions} hired`, `since ${labelYMD(o.openedOn)}`].filter(Boolean).join(' · ')}</T>
                </View>
                {o.status === 'on_hold' ? <Badge tone="warning">On hold</Badge> : null}
                <ChevronRight size={16} color={c.inkMute} />
              </Tap>
              {f.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{f.map((x) => <Badge key={x.stage} tone={x.stage === 'hired' ? 'success' : x.stage === 'rejected' ? 'default' : 'primary'}>{x.label} {x.count}</Badge>)}</View> : null}
              {byOpening(o).map((x) => (
                <Tap key={x.id} onPress={() => router.push({ pathname: '/m/hr/recruitment/candidate', params: { id: x.id } } as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar name={x.name} size={32} />
                  <T style={{ flex: 1 }} numberOfLines={1}>{x.name}</T>
                  <Badge tone="default">{STAGE_LABEL[x.stage]}</Badge>
                </Tap>
              ))}
              {o.status !== 'closed' ? <Button label="Add candidate" kind="soft" size="sm" icon={<UserPlus size={16} color={c.primary} />} onPress={() => router.push({ pathname: '/m/hr/recruitment/candidate', params: { openingId: o.id } } as never)} /> : null}
            </Card>
          )
        }) : <EmptyState icon={<Briefcase size={26} color={c.primary} />} title={tab === 'open' ? 'No open positions' : 'No closed openings'} hint="Post an opening, add the people who apply, and move them from applied to screening, interview and offer. Hiring one makes them an employee with a joining checklist." action={tab === 'open' ? 'Post an opening' : undefined} onAction={() => router.push('/m/hr/recruitment/opening')} />}
      </View>
    </Screen>
  )
}
