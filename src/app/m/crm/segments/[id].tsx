import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { csvFileName } from '@/domain/csv'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { perform, useApp, useCan } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Avatar, Badge, Card, Group, Tap } from '@/ui/primitives'
import { EmptyState, KV, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Download, Megaphone, Pencil, Trash, Users } from '@/ui/icons'
import { ask } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'
import { deleteSegment } from '@/modules/crm/ops'
import { segmentCsv, segmentFigures } from '@/modules/crm/reports'
import { describeSegment, matchCtx, resolveAudience, segmentMembers } from '@/modules/crm/segments'
import { statsOf } from '@/modules/crm/stats'
import { failWith } from '@/modules/crm/ui/forms'

/** Who is in a segment today, with the ways to use it: message them, export them, or change the rules. */
export default function SegmentView() {
  const { c } = useTheme()
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id: string }>()
  const can = useCan('customers')
  const manage = useCan('crm')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const aud = resolveAudience(data, id)
  const view = useMemo(() => {
    if (!aud) return null
    const m = matchCtx(data, now)
    const members = segmentMembers(data, aud.def, now, m)
    return { m, members, fig: segmentFigures(members, data, now) }
  }, [data, aud, now])

  if (!can) return <Screen title="Segment" back><T tone="mute">Segments are for people who use the billing counter.</T></Screen>
  if (!aud || !view) return <Screen title="Not found" back><T tone="mute">This segment is no longer here.</T></Screen>
  const custom = id !== 'all' && !id.startsWith('preset:')

  async function remove() {
    if (!(await ask({ title: 'Delete this segment?', message: 'Customers are not affected. Campaigns already built from it keep their lists.', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deleteSegment(s, id, ctx)); router.back() } catch (e) { failWith(e) }
  }

  return (
    <Screen title={aud.name} subtitle={describeSegment(aud.def)} back>
      <View style={{ gap: 14, paddingBottom: 24 }}>
        <Card>
          <KV k="Customers" v={String(view.fig.count)} strong />
          <KV k="Can be messaged" v={String(view.fig.reachable)} sub="Valid mobile number, not opted out" />
          <KV k="Spent so far" v={inr(view.fig.spend, 0)} />
        </Card>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {manage ? <Button label="Send a message" size="sm" icon={<Megaphone size={16} color={c.onPrimary} />} onPress={() => router.push({ pathname: '/m/crm/campaigns/new', params: { audience: id } })} /> : null}
          <Button label="Export" kind="soft" size="sm" icon={<Download size={16} color={c.primary} />} onPress={() => void shareFile(csvFileName(`segment ${aud.name}`), segmentCsv(view.members, view.m.stats, now))} />
          {manage && custom ? <Button label="Edit" kind="soft" size="sm" icon={<Pencil size={16} color={c.primary} />} onPress={() => router.push({ pathname: '/m/crm/segments/edit', params: { id } })} /> : null}
          {manage && custom ? <Button label="Delete" kind="ghost" size="sm" icon={<Trash size={16} color={c.danger} />} onPress={() => void remove()} /> : null}
        </View>
        <Section title="Members" style={{ marginTop: 0 }}>
          {view.members.length ? (
            <Group>
              {view.members.slice(0, 200).map((m) => {
                const s = statsOf(view.m.stats, m.id)
                return (
                  <Tap key={m.id} onPress={() => router.push({ pathname: '/m/crm/customer/[id]', params: { id: m.id } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                    <Avatar name={m.name} size={38} />
                    <View style={{ flex: 1 }}>
                      <T v="bodyStrong" numberOfLines={1}>{m.name}</T>
                      <T v="caption" tone="mute" numberOfLines={1}>{m.phone || 'No phone'}{s.lastAt !== null ? ` · last ${fmtDayShort(s.lastAt)}` : ' · never bought'}</T>
                    </View>
                    {m.optOutMarketing ? <Badge tone="warning">No promos</Badge> : null}
                    <T v="num">{inr(s.spend, 0)}</T>
                  </Tap>
                )
              })}
            </Group>
          ) : (
            <EmptyState icon={<Users size={26} color={c.primary} />} title="No one matches right now" hint="This updates by itself as customers buy, so check back later." />
          )}
          {view.members.length > 200 ? <T v="caption" tone="mute" style={{ marginTop: 8 }}>Showing the first 200. Export for the full list.</T> : null}
        </Section>
      </View>
    </Screen>
  )
}
