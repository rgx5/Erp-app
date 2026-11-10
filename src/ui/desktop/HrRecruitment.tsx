import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useCan } from '@/data/store'
import { funnel, openingStats, STAGE_LABEL } from '@/modules/hr/logic/recruitment'
import { labelYMD } from '@/modules/hr/logic/ymd'
import type { Candidate, Opening } from '@/modules/hr/types'
import { useHr } from '@/modules/hr/ui/common'
import { T } from '@/ui/Text'
import { Plus, UserPlus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, dtext } from './kit'

type Tab = 'open' | 'closed'

/** The desktop recruitment hub: openings as cards (each with its funnel and open candidates), same as the phone
 * screen, re-laid-out with desktop chrome — a KPI strip, a toolbar action and the Open/Closed toggle visible. */
export function DesktopRecruitment() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('hr')
  const { data } = useHr()
  const [tab, setTab] = useState<Tab>('open')
  const openings = Object.values(data.hrOpenings ?? {}).filter((o) => (tab === 'open' ? o.status !== 'closed' : o.status === 'closed')).sort((a, b) => b.openedOn.localeCompare(a.openedOn))
  const allOpenings = Object.values(data.hrOpenings ?? {})
  const cands = Object.values(data.hrCandidates ?? {})

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Recruitment" />}>
        <View style={{ padding: 20 }}><T tone="mute">Recruitment is for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const byOpening = (o: Opening): Candidate[] => cands.filter((x) => x.openingId === o.id && x.stage !== 'rejected' && x.stage !== 'hired').sort((a, b) => b.updatedAt - a.updatedAt)
  const openCount = allOpenings.filter((o) => o.status !== 'closed').length

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Recruitment"
          subtitle={`${openCount} open ${openCount === 1 ? 'position' : 'positions'}`}
          right={<DeskButton label="Opening" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/hr/recruitment/opening')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Open positions" value={String(openCount)} tone="primary" />
        <KpiTile label="Active candidates" value={String(cands.filter((x) => x.stage !== 'rejected' && x.stage !== 'hired').length)} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented<Tab> value={tab} onChange={setTab} options={[{ id: 'open', label: 'Open' }, { id: 'closed', label: 'Closed' }]} />
      </View>

      <View style={{ flex: 1, paddingHorizontal: 14, paddingBottom: 14 }}>
        {openings.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            {openings.map((o) => {
              const st = openingStats(data, o.id)
              const f = funnel(cands, o.id).filter((x) => x.count > 0)
              return (
                <View key={o.id} style={{ width: 360, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, padding: 14, gap: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ flex: 1, gap: 1 }}>
                      <T style={dtext.cellStrong} onPress={() => router.push({ pathname: '/m/hr/recruitment/opening', params: { id: o.id } } as never)}>{o.title}</T>
                      <T style={[dtext.tiny, { color: c.inkMute }]}>{[o.department, o.location, `${st.hired}/${o.positions} hired`, `since ${labelYMD(o.openedOn)}`].filter(Boolean).join(' · ')}</T>
                    </View>
                    {o.status === 'on_hold' ? <Pill tone="warning" label="On hold" /> : null}
                  </View>
                  {f.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{f.map((x) => <Pill key={x.stage} tone={x.stage === 'hired' ? 'success' : x.stage === 'rejected' ? 'default' : 'primary'} label={`${x.label} ${x.count}`} />)}</View> : null}
                  <View style={{ gap: 6 }}>
                    {byOpening(o).map((x) => (
                      <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <T style={{ flex: 1 }} onPress={() => router.push({ pathname: '/m/hr/recruitment/candidate', params: { id: x.id } } as never)} numberOfLines={1}>{x.name}</T>
                        <Pill label={STAGE_LABEL[x.stage]} />
                      </View>
                    ))}
                  </View>
                  {o.status !== 'closed' ? <DeskButton label="Add candidate" icon={<UserPlus size={14} color={c.ink} />} onPress={() => router.push({ pathname: '/m/hr/recruitment/candidate', params: { openingId: o.id } } as never)} /> : null}
                </View>
              )
            })}
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><T tone="mute">{tab === 'open' ? 'No open positions' : 'No closed openings'}</T></View>
        )}
      </View>
    </DeskPage>
  )
}
