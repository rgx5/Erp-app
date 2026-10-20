import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { variantLabel } from '@/domain/codes'
import { endOfDay, fromInputDate, startOfDay, toInputDate } from '@/domain/dates'
import { inr, round2 } from '@/domain/money'
import { useList, useVariantViews } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { ItemPicker } from '@/features/ItemPicker'
import { deletePromotion, savePromotion, type PromotionDraft } from '@/modules/pricing/ops'
import { promotionProblem } from '@/modules/pricing/promotions'
import { PROMO_LABEL, type PromoKind, type PromoScope } from '@/modules/pricing/types'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Card, Chip } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dateOk = (t: string) => !t || /^\d{4}-\d{2}-\d{2}$/.test(t)

/** One promotion: what it does, which items, and when it runs. */
export default function PromotionPage() {
  const { c } = useTheme()
  const router = useRouter()
  const { id, kind: kindParam } = useLocalSearchParams<{ id: string; kind?: PromoKind }>()
  const can = useCan('pricing')
  const promos = useList('promotions')
  const categories = useList('categories')
  const views = useVariantViews()
  const existing = id && id !== 'new' ? promos.find((p) => p.id === id) : undefined
  const kind: PromoKind = existing?.kind ?? kindParam ?? 'category_sale'
  const ex = existing as (typeof existing & Record<string, never>) | undefined

  const [name, setName] = useState(existing?.name ?? '')
  const [active, setActive] = useState(existing?.active ?? true)
  const [priority, setPriority] = useState(String(existing?.priority ?? 0))
  const [retailOnly, setRetailOnly] = useState(existing?.retailOnly ?? false)
  const [from, setFrom] = useState(existing?.validFrom ? toInputDate(existing.validFrom) : '')
  const [to, setTo] = useState(existing?.validTo ? toInputDate(existing.validTo) : '')
  const [days, setDays] = useState<number[]>(existing?.days ?? [])
  const [start, setStart] = useState(existing?.startTime ?? (kind === 'happy_hour' ? '16:00' : ''))
  const [end, setEnd] = useState(existing?.endTime ?? (kind === 'happy_hour' ? '18:00' : ''))
  const [scope, setScope] = useState<PromoScope>((ex as { scope?: PromoScope } | undefined)?.scope ?? (kind === 'happy_hour' ? { all: true } : {}))
  const [buyQty, setBuyQty] = useState(String((ex as { buyQty?: number } | undefined)?.buyQty ?? 2))
  const [getQty, setGetQty] = useState(String((ex as { getQty?: number } | undefined)?.getQty ?? 1))
  const [getPct, setGetPct] = useState(String((ex as { getPct?: number } | undefined)?.getPct ?? 100))
  const [sameItem, setSameItem] = useState((ex as { sameItem?: boolean } | undefined)?.sameItem ?? false)
  const [offType, setOffType] = useState<'pct' | 'amt'>((ex as { off?: { type: 'pct' | 'amt' } } | undefined)?.off?.type ?? 'pct')
  const [offValue, setOffValue] = useState(String((ex as { off?: { value: number } } | undefined)?.off?.value ?? 10))
  const [items, setItems] = useState<Array<{ variantId: string; qty: string }>>(((ex as { items?: Array<{ variantId: string; qty: number }> } | undefined)?.items ?? []).map((i) => ({ variantId: i.variantId, qty: String(i.qty) })))
  const [bundlePrice, setBundlePrice] = useState(String((ex as { price?: number } | undefined)?.price ?? ''))
  const [picking, setPicking] = useState<'scope' | 'bundle' | null>(null)
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map(views.map((v) => [v.id, v])), [views])

  if (!can) return <Screen title="Promotion" back><T tone="mute">Promotions are for the owner and managers.</T></Screen>
  if (id && id !== 'new' && !existing) return <Screen title="Not found" back><T tone="mute">This promotion is no longer here.</T></Screen>

  const toggle = <K extends keyof PromoScope>(key: K, v: string) => setScope((s) => {
    const cur = ((s[key] as string[] | undefined) ?? [])
    return { ...s, all: false, [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }
  })
  const schedule = {
    ...(from ? { validFrom: startOfDay(fromInputDate(from)) } : {}), ...(to ? { validTo: endOfDay(fromInputDate(to)) } : {}),
    ...(days.length ? { days } : {}), ...(start && end ? { startTime: start, endTime: end } : {}),
  }
  const base = { name, active, priority: Number(priority) || 0, ...(retailOnly ? { retailOnly: true } : {}), ...schedule }
  const draft: PromotionDraft = kind === 'buy_x_get_y'
    ? { ...base, kind, scope, buyQty: Number(buyQty) || 0, getQty: Number(getQty) || 0, getPct: Number(getPct) || 0, ...(sameItem ? { sameItem: true } : {}) }
    : kind === 'bundle'
      ? { ...base, kind, items: items.map((i) => ({ variantId: i.variantId, qty: Number(i.qty) || 0 })), price: Number(bundlePrice) || 0 }
      : { ...base, kind, scope, off: { type: offType, value: Number(offValue) || 0 } }
  const problem = (!dateOk(from) || !dateOk(to)) ? 'Write dates as YYYY-MM-DD.' : promotionProblem({ ...draft, id: 'x' } as never)
  const normal = round2(items.reduce((s, i) => s + (byId.get(i.variantId)?.price ?? 0) * (Number(i.qty) || 0), 0))

  function save() {
    setBusy(true)
    try {
      const r = perform((s, ctx) => savePromotion(s, draft, existing?.id, ctx))
      toast(`${r.promotion.name} saved`, 'ok'); router.back()
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save the promotion', 'err'); setBusy(false) }
  }
  async function remove() {
    if (!existing || !(await ask({ title: `Delete ${existing.name}?`, message: 'Bills already made keep what it took off.', confirm: 'Delete', danger: true }))) return
    try { perform((s, ctx) => deletePromotion(s, existing.id, ctx)); router.back() } catch (e) { toast(e instanceof OpError ? e.message : 'Could not delete', 'err') }
  }
  const scopeNames = [
    ...(scope.categoryIds ?? []).map((k) => categories.find((x) => x.id === k)?.name ?? k),
    ...(scope.variantIds ?? []).map((v) => byId.get(v)?.productName ?? v),
  ]

  return (
    <Screen title={existing ? existing.name : `New ${PROMO_LABEL[kind].toLowerCase()}`} back footer={<Button label="Save promotion" size="lg" block loading={busy} onPress={save} disabled={!!problem && !!name} />}>
      <View style={{ gap: 6, paddingBottom: 14 }}>
        <Section title={PROMO_LABEL[kind]}>
          <View style={{ gap: 14 }}>
            <Field label="Name (shown on the bill)" value={name} onChangeText={setName} placeholder={kind === 'happy_hour' ? 'Tea-time 10%' : 'Diwali jeans sale'} />
            {kind === 'buy_x_get_y' ? (
              <>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><NumberField label="Buy" value={buyQty} onChange={setBuyQty} /></View>
                  <View style={{ flex: 1 }}><NumberField label="Get" value={getQty} onChange={setGetQty} /></View>
                  <View style={{ flex: 1 }}><NumberField label="At % off" value={getPct} onChange={setGetPct} decimals /></View>
                </View>
                <Card padded={false}><SwitchRow title="Same item only" subtitle="Otherwise any covered items mix and match, and the cheapest are discounted" value={sameItem} onChange={setSameItem} /></Card>
              </>
            ) : null}
            {kind === 'category_sale' || kind === 'happy_hour' ? (
              <View style={{ gap: 6 }}>
                <T v="label" tone="soft">Takes off</T>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={{ width: 128 }}><Segmented compact value={offType} options={[{ value: 'pct', label: '%' }, { value: 'amt', label: '₹ each' }]} onChange={setOffType} /></View>
                  <View style={{ flex: 1 }}><NumberField value={offValue} onChange={setOffValue} decimals /></View>
                </View>
              </View>
            ) : null}
          </View>
        </Section>

        {kind === 'bundle' ? (
          <Section title="Items in the bundle" style={{ marginTop: 18 }}>
            <View style={{ gap: 10 }}>
              {items.map((it) => {
                const v = byId.get(it.variantId)
                return (
                  <Card key={it.variantId} style={{ gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1 }}><T v="bodyStrong" numberOfLines={1}>{v?.productName ?? 'Item'}</T><T v="caption" tone="mute">{[variantLabel(v?.size ?? '', v?.color ?? ''), v ? inr(v.price) : ''].filter(Boolean).join(' · ')}</T></View>
                      <View style={{ width: 90 }}><NumberField value={it.qty} onChange={(t) => setItems(items.map((x) => (x.variantId === it.variantId ? { ...x, qty: t } : x)))} /></View>
                      <IconButton label="Remove" tone="ghost" size={36} onPress={() => setItems(items.filter((x) => x.variantId !== it.variantId))}><Trash size={18} color={c.inkMute} /></IconButton>
                    </View>
                  </Card>
                )
              })}
              <Button label="Add an item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setPicking('bundle')} />
              <MoneyField label={normal ? `Bundle price (normally ${inr(normal)})` : 'Bundle price'} value={bundlePrice} onChange={setBundlePrice} />
            </View>
          </Section>
        ) : (
          <Section title="Which items" style={{ marginTop: 18 }}>
            <View style={{ gap: 10 }}>
              <Card padded={false}><SwitchRow title="Everything in the shop" value={!!scope.all} onChange={(v) => setScope(v ? { all: true } : {})} /></Card>
              {!scope.all ? (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {categories.map((k) => <Chip key={k.id} label={k.name} selected={!!scope.categoryIds?.includes(k.id)} onPress={() => toggle('categoryIds', k.id)} />)}
                  </View>
                  {(scope.variantIds ?? []).map((vid) => (
                    <Chip key={vid} label={`${byId.get(vid)?.productName ?? 'Item'} ✕`} selected onPress={() => toggle('variantIds', vid)} />
                  ))}
                  <Button label="Add a single item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => setPicking('scope')} />
                </>
              ) : null}
              {!scope.all && scopeNames.length ? <T v="caption" tone="mute">Covers: {scopeNames.join(', ')}</T> : null}
            </View>
          </Section>
        )}

        <Section title="When" style={{ marginTop: 18 }}>
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="From (optional)" value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" error={dateOk(from) ? null : 'YYYY-MM-DD'} /></View>
              <View style={{ flex: 1 }}><Field label="Until (optional)" value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" error={dateOk(to) ? null : 'YYYY-MM-DD'} /></View>
            </View>
            <View style={{ gap: 6 }}>
              <T v="label" tone="soft">Days (none picked = every day)</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {DAYS.map((d, n) => <Chip key={d} label={d} selected={days.includes(n)} onPress={() => setDays(days.includes(n) ? days.filter((x) => x !== n) : [...days, n])} />)}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label={kind === 'happy_hour' ? 'From time' : 'From time (optional)'} value={start} onChangeText={setStart} placeholder="16:00" /></View>
              <View style={{ flex: 1 }}><Field label={kind === 'happy_hour' ? 'Until time' : 'Until time (optional)'} value={end} onChangeText={setEnd} placeholder="18:00" /></View>
            </View>
          </View>
        </Section>

        <Section title="Rules" style={{ marginTop: 18 }}>
          <View style={{ gap: 12 }}>
            <Card padded={false}>
              <SwitchRow title="Retail customers only" subtitle="Skip customers on a wholesale or dealer list" value={retailOnly} onChange={setRetailOnly} />
              <SwitchRow title="In use" value={active} onChange={setActive} />
            </Card>
            <NumberField label="Priority (lower goes first)" value={priority} onChange={setPriority} hint="Each piece of an item is used by one offer. When two offers want the same piece, the lower priority number gets it." />
            <Notice tone="primary" title="Never on" body="Items marked “no discount” and lines a manager priced by hand are left out." />
            {problem && name ? <Notice tone="warning" title={problem} /> : null}
            {existing ? <Button label="Delete promotion" kind="danger" block onPress={remove} /> : null}
          </View>
        </Section>
      </View>
      <ItemPicker visible={picking !== null} onClose={() => setPicking(null)} title={picking === 'bundle' ? 'Add to the bundle' : 'Add an item to the promotion'}
        picked={new Set(picking === 'bundle' ? items.map((i) => i.variantId) : scope.variantIds ?? [])}
        onPick={(v) => { if (picking === 'bundle') setItems((cur) => (cur.some((x) => x.variantId === v.id) ? cur : [...cur, { variantId: v.id, qty: '1' }])); else toggle('variantIds', v.id) }} />
    </Screen>
  )
}
