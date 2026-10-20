import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { listPrice } from '@/modules/pricing/prices'
import { TIER_LABEL, type Tier } from '@/modules/pricing/types'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Card, Badge } from '@/ui/primitives'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Tags } from '@/ui/icons'
import { useTheme, type Tone } from '@/ui/theme'

const TONE: Record<Tier, Tone> = { retail: 'default', wholesale: 'primary', dealer: 'accent' }
const BASIS = { price: 'selling price', mrp: 'MRP', cost: 'cost' } as const

/** Price lists: retail, wholesale and dealer prices, and who buys on each. */
export default function PriceLists() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pricing')
  const lists = useList('priceLists')
  const customers = useList('customers')
  const items = useList('priceListItems')

  if (!can) return <Screen title="Price lists" back><T tone="mute">Price lists are for the owner and managers.</T></Screen>
  const open = (id: string) => router.push({ pathname: '/m/pricing/lists/[id]', params: { id } })
  return (
    <Screen title="Price lists" subtitle={`${lists.length} lists`} back right={<IconButton label="New price list" tone="dark" onPress={() => open('new')}><Plus size={22} color={c.bg} /></IconButton>}>
      {!lists.length ? (
        <EmptyState icon={<Tags size={26} color={c.primary} />} title="No price lists yet" hint="Make a wholesale or dealer list, then put customers on it. They are priced on it automatically at the counter." action="New price list" onAction={() => open('new')} />
      ) : (
        <Section title="Lists">
          <Card padded={false}>
            {[...lists].sort((a, b) => a.name.localeCompare(b.name)).map((l, i) => {
              const people = customers.filter((x) => x.priceListId === l.id).length
              const own = items.filter((x) => x.listId === l.id).length
              return (
                <View key={l.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <ListRow title={l.name} icon={<Tags size={18} color={c.primary} />}
                    subtitle={`${l.pct === 0 && l.basis === 'price' ? 'Selling price' : `${BASIS[l.basis]} ${l.pct > 0 ? '+' : ''}${l.pct}%`} · ${own} own ${own === 1 ? 'price' : 'prices'} · ${people} ${people === 1 ? 'customer' : 'customers'}`}
                    badge={<View style={{ flexDirection: 'row', gap: 6 }}><Badge tone={TONE[l.tier]}>{TIER_LABEL[l.tier]}</Badge>{l.active ? null : <Badge tone="warning">Off</Badge>}</View>} onPress={() => open(l.id)} />
                </View>
              )
            })}
          </Card>
          <T v="caption" tone="mute">Example: a list at selling price −10% charges ₹{listPrice({ id: '', name: '', tier: 'wholesale', basis: 'price', pct: -10, roundTo: 0, active: true }, { price: 1000, mrp: 1200, cost: 600 })} for an item that normally sells at ₹1,000.</T>
        </Section>
      )}
    </Screen>
  )
}
