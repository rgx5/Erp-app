import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { setPromotionActive } from '@/modules/pricing/ops'
import { describePromotion, describeSchedule, promoResults, promoStatus } from '@/modules/pricing/promotions'
import { PROMO_LABEL, type PromoKind } from '@/modules/pricing/types'
import { IconButton } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card, Tap } from '@/ui/primitives'
import { EmptyState, ListRow, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { BadgePercent, Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme, type Tone } from '@/ui/theme'

const STATUS: Record<ReturnType<typeof promoStatus>, { label: string; tone: Tone }> = {
  running: { label: 'Running', tone: 'success' }, scheduled: { label: 'Scheduled', tone: 'primary' }, ended: { label: 'Ended', tone: 'default' }, off: { label: 'Off', tone: 'warning' },
}
const KIND_HINT: Record<PromoKind, string> = {
  buy_x_get_y: 'Buy 2 get 1 free, or the second at half price', bundle: 'A shirt and a tie together for one price',
  category_sale: '20% off all jeans', happy_hour: '10% off between 4 and 6 pm',
}

/** Promotions: what is on, what each has taken off. */
export default function Promotions() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pricing')
  const promos = useList('promotions')
  const bills = useList('bills')
  const [choosing, setChoosing] = useState(false)
  const now = Date.now()
  const results = useMemo(() => promoResults(bills), [bills])

  if (!can) return <Screen title="Promotions" back><T tone="mute">Promotions are for the owner and managers.</T></Screen>
  const open = (id: string, kind?: PromoKind) => { setChoosing(false); router.push({ pathname: '/m/pricing/promotions/[id]', params: { id, ...(kind ? { kind } : {}) } }) }

  return (
    <Screen title="Promotions" subtitle={`${promos.filter((p) => promoStatus(p, now) === 'running').length} running`} back right={<IconButton label="New promotion" tone="dark" onPress={() => setChoosing(true)}><Plus size={22} color={c.bg} /></IconButton>}>
      {!promos.length ? (
        <EmptyState icon={<BadgePercent size={26} color={c.primary} />} title="No promotions yet" hint="Offers apply at the counter by themselves while they run. Each piece of an item is used by one offer only, so they never pile up." action="New promotion" onAction={() => setChoosing(true)} />
      ) : (
        <>
          <Card padded={false}>
            {[...promos].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.name.localeCompare(b.name)).map((p, i) => {
              const st = STATUS[promoStatus(p, now)]
              return (
                <View key={p.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <ListRow title={p.name} subtitle={`${PROMO_LABEL[p.kind]} · ${describePromotion(p)}`} meta={describeSchedule(p)} icon={<BadgePercent size={18} color={c.warning} />} iconTone="warning"
                    badge={<Badge tone={st.tone}>{st.label}</Badge>} onPress={() => open(p.id)} />
                </View>
              )
            })}
          </Card>
          <Section title="What they have taken off" style={{ marginTop: 20 }}>
            {results.length ? (
              <Card padded={false}>
                {results.map((r, i) => (
                  <View key={r.id} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                    <ListRow title={r.name} subtitle={`${r.bills} ${r.bills === 1 ? 'bill' : 'bills'}`} value={inr(r.discount, 0)} dense
                      right={promos.find((p) => p.id === r.id) ? <Tap onPress={() => { try { perform((s, ctx) => setPromotionActive(s, r.id, !s.promotions[r.id].active, ctx)) } catch (e) { toast(e instanceof OpError ? e.message : 'Could not change', 'err') } }}><T v="caption" style={{ color: c.primary }}>{promos.find((p) => p.id === r.id)?.active ? 'Switch off' : 'Switch on'}</T></Tap> : undefined} />
                  </View>
                ))}
              </Card>
            ) : <T tone="mute">No bill has used a promotion yet. (Before returns.)</T>}
          </Section>
        </>
      )}
      <Sheet visible={choosing} onClose={() => setChoosing(false)} title="What kind of promotion?">
        {(Object.keys(PROMO_LABEL) as PromoKind[]).map((k) => (
          <Tap key={k} onPress={() => open('new', k)} style={{ paddingVertical: 13, gap: 2 }}>
            <T v="bodyStrong">{PROMO_LABEL[k]}</T>
            <T v="caption" tone="mute">{KIND_HINT[k]}</T>
          </Tap>
        ))}
      </Sheet>
    </Screen>
  )
}
