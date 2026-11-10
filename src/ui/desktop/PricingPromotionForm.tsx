import React from 'react'
import { View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { inr } from '@/domain/money'
import { ItemPicker } from '@/features/ItemPicker'
import { PROMO_LABEL, type PromoKind, type PromoScope } from '@/modules/pricing/types'
import type { VariantView } from '@/domain/views'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Card, Chip } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DeskButton } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export interface DesktopPromotionFormProps {
  existing: { name: string } | undefined; kind: PromoKind; busy: boolean; problem: string | null
  name: string; setName: (v: string) => void; active: boolean; setActive: (v: boolean) => void
  priority: string; setPriority: (v: string) => void; retailOnly: boolean; setRetailOnly: (v: boolean) => void
  from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void; dateOk: (t: string) => boolean
  days: number[]; setDays: (v: number[]) => void; start: string; setStart: (v: string) => void; end: string; setEnd: (v: string) => void
  scope: PromoScope; toggle: <K extends keyof PromoScope>(key: K, v: string) => void; setScopeAll: (v: boolean) => void
  buyQty: string; setBuyQty: (v: string) => void; getQty: string; setGetQty: (v: string) => void; getPct: string; setGetPct: (v: string) => void
  sameItem: boolean; setSameItem: (v: boolean) => void
  offType: 'pct' | 'amt'; setOffType: (v: 'pct' | 'amt') => void; offValue: string; setOffValue: (v: string) => void
  items: Array<{ variantId: string; qty: string }>; setItems: (v: Array<{ variantId: string; qty: string }>) => void
  bundlePrice: string; setBundlePrice: (v: string) => void; normal: number
  categories: Array<{ id: string; name: string }>; byId: Map<string, VariantView>; scopeNames: string[]
  picking: 'scope' | 'bundle' | null; setPicking: (v: 'scope' | 'bundle' | null) => void
  onPick: (v: VariantView) => void
  onSave: () => void; onRemove: () => void
}

/** The desktop promotion form: the exact fields the phone screen shows for the chosen kind, reusing the same mobile components. */
export function DesktopPromotionForm(p: DesktopPromotionFormProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage
      title={p.existing ? p.existing.name : `New ${PROMO_LABEL[p.kind].toLowerCase()}`}
      subtitle="Promotions"
      right={<Button label="Save promotion" loading={p.busy} disabled={!!p.problem && !!p.name} onPress={p.onSave} />}
    >
      <View style={{ gap: 6 }}>
        <Section title={PROMO_LABEL[p.kind]} style={{ marginTop: 0 }}>
          <View style={{ gap: 14 }}>
            <Field label="Name (shown on the bill)" value={p.name} onChangeText={p.setName} placeholder={p.kind === 'happy_hour' ? 'Tea-time 10%' : 'Diwali jeans sale'} />
            {p.kind === 'buy_x_get_y' ? (
              <>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}><NumberField label="Buy" value={p.buyQty} onChange={p.setBuyQty} /></View>
                  <View style={{ flex: 1 }}><NumberField label="Get" value={p.getQty} onChange={p.setGetQty} /></View>
                  <View style={{ flex: 1 }}><NumberField label="At % off" value={p.getPct} onChange={p.setGetPct} decimals /></View>
                </View>
                <Card padded={false}><SwitchRow title="Same item only" subtitle="Otherwise any covered items mix and match, and the cheapest are discounted" value={p.sameItem} onChange={p.setSameItem} /></Card>
              </>
            ) : null}
            {p.kind === 'category_sale' || p.kind === 'happy_hour' ? (
              <View style={{ gap: 6 }}>
                <T v="label" tone="soft">Takes off</T>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={{ width: 128 }}><Segmented compact value={p.offType} options={[{ value: 'pct', label: '%' }, { value: 'amt', label: '₹ each' }]} onChange={p.setOffType} /></View>
                  <View style={{ flex: 1 }}><NumberField value={p.offValue} onChange={p.setOffValue} decimals /></View>
                </View>
              </View>
            ) : null}
          </View>
        </Section>

        {p.kind === 'bundle' ? (
          <Section title="Items in the bundle">
            <View style={{ gap: 10 }}>
              {p.items.map((it) => {
                const v = p.byId.get(it.variantId)
                return (
                  <Card key={it.variantId} style={{ gap: 8 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1 }}><T v="bodyStrong" numberOfLines={1}>{v?.productName ?? 'Item'}</T><T v="caption" tone="mute">{[variantLabel(v?.size ?? '', v?.color ?? ''), v ? inr(v.price) : ''].filter(Boolean).join(' · ')}</T></View>
                      <View style={{ width: 90 }}><NumberField value={it.qty} onChange={(t) => p.setItems(p.items.map((x) => (x.variantId === it.variantId ? { ...x, qty: t } : x)))} /></View>
                      <IconButton label="Remove" tone="ghost" size={36} onPress={() => p.setItems(p.items.filter((x) => x.variantId !== it.variantId))}><Trash size={18} color={c.inkMute} /></IconButton>
                    </View>
                  </Card>
                )
              })}
              <Button label="Add an item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => p.setPicking('bundle')} />
              <MoneyField label={p.normal ? `Bundle price (normally ${inr(p.normal)})` : 'Bundle price'} value={p.bundlePrice} onChange={p.setBundlePrice} />
            </View>
          </Section>
        ) : (
          <Section title="Which items">
            <View style={{ gap: 10 }}>
              <Card padded={false}><SwitchRow title="Everything in the shop" value={!!p.scope.all} onChange={p.setScopeAll} /></Card>
              {!p.scope.all ? (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {p.categories.map((k) => <Chip key={k.id} label={k.name} selected={!!p.scope.categoryIds?.includes(k.id)} onPress={() => p.toggle('categoryIds', k.id)} />)}
                  </View>
                  {(p.scope.variantIds ?? []).map((vid) => (
                    <Chip key={vid} label={`${p.byId.get(vid)?.productName ?? 'Item'} ✕`} selected onPress={() => p.toggle('variantIds', vid)} />
                  ))}
                  <Button label="Add a single item" kind="soft" block icon={<Plus size={18} color={c.primary} />} onPress={() => p.setPicking('scope')} />
                </>
              ) : null}
              {!p.scope.all && p.scopeNames.length ? <T v="caption" tone="mute">Covers: {p.scopeNames.join(', ')}</T> : null}
            </View>
          </Section>
        )}

        <Section title="When">
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label="From (optional)" value={p.from} onChangeText={p.setFrom} placeholder="YYYY-MM-DD" error={p.dateOk(p.from) ? null : 'YYYY-MM-DD'} /></View>
              <View style={{ flex: 1 }}><Field label="Until (optional)" value={p.to} onChangeText={p.setTo} placeholder="YYYY-MM-DD" error={p.dateOk(p.to) ? null : 'YYYY-MM-DD'} /></View>
            </View>
            <View style={{ gap: 6 }}>
              <T v="label" tone="soft">Days (none picked = every day)</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {DAYS.map((d, n) => <Chip key={d} label={d} selected={p.days.includes(n)} onPress={() => p.setDays(p.days.includes(n) ? p.days.filter((x) => x !== n) : [...p.days, n])} />)}
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}><Field label={p.kind === 'happy_hour' ? 'From time' : 'From time (optional)'} value={p.start} onChangeText={p.setStart} placeholder="16:00" /></View>
              <View style={{ flex: 1 }}><Field label={p.kind === 'happy_hour' ? 'Until time' : 'Until time (optional)'} value={p.end} onChangeText={p.setEnd} placeholder="18:00" /></View>
            </View>
          </View>
        </Section>

        <Section title="Rules">
          <View style={{ gap: 12 }}>
            <Card padded={false}>
              <SwitchRow title="Retail customers only" subtitle="Skip customers on a wholesale or dealer list" value={p.retailOnly} onChange={p.setRetailOnly} />
              <SwitchRow title="In use" value={p.active} onChange={p.setActive} />
            </Card>
            <NumberField label="Priority (lower goes first)" value={p.priority} onChange={p.setPriority} hint="Each piece of an item is used by one offer. When two offers want the same piece, the lower priority number gets it." />
            <Notice tone="primary" title="Never on" body="Items marked “no discount” and lines a manager priced by hand are left out." />
            {p.problem && p.name ? <Notice tone="warning" title={p.problem} /> : null}
            {p.existing ? <DeskButton label="Delete promotion" tone="danger" onPress={p.onRemove} /> : null}
          </View>
        </Section>
      </View>
      <ItemPicker visible={p.picking !== null} onClose={() => p.setPicking(null)} title={p.picking === 'bundle' ? 'Add to the bundle' : 'Add an item to the promotion'}
        picked={new Set(p.picking === 'bundle' ? p.items.map((i) => i.variantId) : p.scope.variantIds ?? [])}
        onPick={p.onPick} />
    </DesktopSettingsPage>
  )
}
