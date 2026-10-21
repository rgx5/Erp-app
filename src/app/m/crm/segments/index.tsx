import React, { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { IconButton } from '@/ui/Button'
import { useApp, useCan } from '@/data/store'
import { listOf } from '@/data/state'
import { Screen } from '@/ui/Screen'
import { Group } from '@/ui/primitives'
import { ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Users } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { defOf, describeSegment, matchCtx, matchesSegment, PRESET_SEGMENTS } from '@/modules/crm/segments'

/** Ready-made and saved segments, each with how many customers are in it today. */
export default function Segments() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('customers')
  const manage = useCan('crm')
  const data = useApp((s) => s.data)
  const now = Date.now()
  const rows = useMemo(() => {
    const m = matchCtx(data, now)
    const customers = listOf(data.customers)
    const count = (def: { match: 'all' | 'any'; rules: never[] } | ReturnType<typeof defOf>) => customers.filter((x) => matchesSegment(x, def, m)).length
    return {
      presets: PRESET_SEGMENTS.map((p) => ({ id: p.id, name: p.name, sub: p.note, n: count(p) })),
      mine: listOf(data.crmSegments ?? {}).sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ id: s.id, name: s.name, sub: describeSegment(s), n: count(defOf(s)) })),
      all: customers.length,
    }
  }, [data, now])

  if (!can) return <Screen title="Segments" back><T tone="mute">Segments are for people who use the billing counter.</T></Screen>
  const open = (id: string) => router.push({ pathname: '/m/crm/segments/[id]', params: { id } })
  return (
    <Screen title="Segments & groups" subtitle={`${rows.all} customers`} back right={manage ? <IconButton label="New segment" tone="dark" onPress={() => router.push('/m/crm/segments/edit')}><Plus size={22} color={c.bg} /></IconButton> : undefined}>
      <View style={{ paddingBottom: 24 }}>
        <Section title="Your segments" style={{ marginTop: 0 }}>
          {rows.mine.length ? (
            <Group>{rows.mine.map((r) => <ListRow key={r.id} icon={<Users size={20} color="#fff" />} title={r.name} subtitle={r.sub} value={String(r.n)} sub="customers" onPress={() => open(r.id)} />)}</Group>
          ) : (
            <T tone="mute">{manage ? 'Make your own with the + button: for example “spent over ₹5,000 and in group Wholesale”.' : 'Your manager can make segments of their own here.'}</T>
          )}
        </Section>
        <Section title="Ready-made">
          <Group>{rows.presets.map((r) => <ListRow key={r.id} icon={<Users size={20} color="#fff" />} iconTone="accent" title={r.name} subtitle={r.sub} value={String(r.n)} sub="customers" onPress={() => open(r.id)} />)}</Group>
        </Section>
        <T v="caption" tone="mute" style={{ marginTop: 12 }}>Segments are worked out from bills each time you open them, so they are always up to date. Add customers to groups from their page, then match on the group.</T>
      </View>
    </Screen>
  )
}
