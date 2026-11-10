import React from 'react'
import { ScrollView, View } from 'react-native'
import { variantLabel } from '@/domain/codes'
import { inr } from '@/domain/money'
import { ItemPicker } from '@/features/ItemPicker'
import { listPrice } from '@/modules/pricing/prices'
import { TIER_LABEL, type PriceBasis, type PriceList, type Tier } from '@/modules/pricing/types'
import type { VariantView } from '@/domain/views'
import { Button, IconButton } from '@/ui/Button'
import { Field, MoneyField, NumberField, Segmented, SwitchRow } from '@/ui/Inputs'
import { Badge, Card } from '@/ui/primitives'
import { Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus, Trash } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, SplitPane, Toolbar, type Column } from './kit'
import { DesktopSettingsPage } from './SettingsPage'

type Row = { id: string; vid: string; v: VariantView; saved: number | undefined }
type Customer = { id: string; name: string }

export interface DesktopPriceListDetailProps {
  existing: PriceList | undefined; busy: boolean
  name: string; setName: (v: string) => void; tier: Tier; setTier: (v: Tier) => void; basis: PriceBasis; setBasis: (v: PriceBasis) => void
  pct: string; setPct: (v: string) => void; roundTo: string; setRoundTo: (v: string) => void
  active: boolean; setActive: (v: boolean) => void; notes: string; setNotes: (v: string) => void
  rule: { id: string; name: string; tier: Tier; basis: PriceBasis; pct: number; roundTo: number; active: boolean }
  rows: Row[]; edits: Record<string, string>; setEdit: (vid: string, t: string) => void; clearEdit: (vid: string) => void; dirty: boolean
  people: Customer[]
  picking: boolean; setPicking: (v: boolean) => void
  onSave: () => void; onSavePrices: () => void; onRemove: () => void; onRemoveCustomer: (customerId: string) => void
  onPickItem: (v: VariantView) => void
}

/**
 * The desktop price-list screen: the list's own rule in a centred form (or, when creating a new list, that form
 * alone), a dense grid of its item-level prices and a customers panel — the same `savePriceList`/`setListPrices`
 * operations the phone `m/pricing/lists/[id].tsx` already calls.
 */
export function DesktopPriceListDetail(p: DesktopPriceListDetailProps) {
  const { c } = useTheme()
  const { existing } = p

  const settingsForm = (
    <View style={{ gap: 14 }}>
      <Field label="Name" value={p.name} onChangeText={p.setName} placeholder="Wholesale" />
      <View style={{ gap: 6 }}>
        <T v="label" tone="soft">Tier</T>
        <Segmented value={p.tier} options={(['retail', 'wholesale', 'dealer'] as Tier[]).map((t) => ({ value: t, label: TIER_LABEL[t] }))} onChange={p.setTier} />
        <T v="caption" tone="mute">Wholesale and dealer lists are left out of offers marked “retail only”.</T>
      </View>
      <View style={{ gap: 6 }}>
        <T v="label" tone="soft">Items without their own price are worked out from</T>
        <Segmented value={p.basis} options={[{ value: 'price', label: 'Selling price' }, { value: 'mrp', label: 'MRP' }, { value: 'cost', label: 'Cost' }]} onChange={p.setBasis} />
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><Field label="Percent (− under, + over)" value={p.pct} onChangeText={(t) => p.setPct(t.replace(/[^0-9.-]/g, ''))} keyboardType="numbers-and-punctuation" suffix="%" /></View>
        <View style={{ flex: 1 }}><NumberField label="Round to nearest ₹" value={p.roundTo} onChange={p.setRoundTo} decimals hint="0 = to the paisa" /></View>
      </View>
      <Notice tone="primary" title={`An item selling at ₹1,000 costs ${inr(listPrice(p.rule, { price: 1000, mrp: 1200, cost: 600 }))}`} body="Prices are in the same terms as your selling prices (including GST if they include it)." />
      <Field label="Notes (optional)" value={p.notes} onChangeText={p.setNotes} multiline />
      <Card padded={false}><SwitchRow title="In use" subtitle="Switch off to stop pricing on it without deleting it" value={p.active} onChange={p.setActive} /></Card>
    </View>
  )

  if (!existing) {
    return (
      <DesktopSettingsPage title="New price list" right={<Button label="Create list" loading={p.busy} disabled={!p.name.trim()} onPress={p.onSave} />}>
        {settingsForm}
      </DesktopSettingsPage>
    )
  }

  const columns: Array<Column<Row>> = [
    { key: 'item', label: 'Item', sortValue: (r) => r.v.productName, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.v.productName}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{[variantLabel(r.v.size, r.v.color), r.v.sku].filter(Boolean).join(' · ')} · sells at {inr(r.v.price)}</T>
      </View>
    ) },
    { key: 'price', label: 'Price on this list', width: 220, render: (r) => {
      const typed = p.edits[r.vid]
      const ruled = listPrice(existing, { price: r.v.price, mrp: r.v.mrp, cost: r.v.cost })
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={{ flex: 1 }}>
            <MoneyField label={typed === '' ? `Cleared — rule gives ${inr(ruled)}` : undefined} value={typed ?? (r.saved !== undefined ? String(r.saved) : '')} onChange={(t) => p.setEdit(r.vid, t)} />
          </View>
          {r.saved !== undefined && typed === undefined ? <Badge tone="primary">Own</Badge> : null}
          <IconButton label="Use the list’s rule" tone="ghost" size={32} onPress={() => p.clearEdit(r.vid)}><Trash size={16} color={c.inkMute} /></IconButton>
        </View>
      )
    } },
  ]

  return (
    <DeskPage
      toolbar={<Toolbar title={existing.name} subtitle="Price list" right={<DeskButton label="Save list" tone="primary" onPress={p.onSave} />} />}
    >
      <KpiStrip>
        <KpiTile label="Item prices" value={String(p.rows.length)} tone="primary" />
        <KpiTile label="Customers" value={String(p.people.length)} tone="accent" />
        <KpiTile label="Status" value={existing.active ? 'In use' : 'Off'} tone={existing.active ? 'success' : 'warning'} />
      </KpiStrip>

      <SplitPane widths={['flex', 360]}>
        <View style={{ flex: 1, gap: 10, margin: 14 }}>
          <View style={{ flex: 1, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
            <DataTable rows={p.rows} columns={columns} emptyLabel="No item prices yet" />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <DeskButton label="Add an item price" icon={<Plus size={14} color={c.ink} />} onPress={() => p.setPicking(true)} />
            {p.dirty ? <DeskButton label="Save item prices" tone="primary" onPress={p.onSavePrices} /> : null}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <Section title="The list" style={{ marginTop: 0 }}>{settingsForm}</Section>
          <Section title={`Customers on this list · ${p.people.length}`}>
            <Card padded={false}>
              {p.people.length ? p.people.map((cu, i) => (
                <View key={cu.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line }}>
                  <T v="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{cu.name}</T>
                  <Button label="Remove" kind="ghost" size="sm" onPress={() => p.onRemoveCustomer(cu.id)} />
                </View>
              )) : <T tone="mute" style={{ padding: 14 }}>Nobody yet. Open a customer and pick this list under Pricing.</T>}
            </Card>
          </Section>
          <Button label="Delete this list" kind="danger" block onPress={p.onRemove} />
        </ScrollView>
      </SplitPane>

      <ItemPicker visible={p.picking} onClose={() => p.setPicking(false)} onPick={p.onPickItem} picked={new Set(p.rows.map((r) => r.vid))} title="Add an item to this list" />
    </DeskPage>
  )
}
