import React from 'react'
import { ScrollView, View } from 'react-native'
import { inr0 } from '@/domain/money'
import type { Location } from '@/modules/warehouse/types'
import type { StockRow } from '@/modules/warehouse/logic'
import { LocationSheet } from '@/modules/warehouse/ui/LocationSheet'
import { ItemField } from '@/modules/warehouse/ui/common'
import { NumberField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Toolbar, cellNum, dtext, type Column } from './kit'

export interface DesktopLocationDetailProps {
  id: string
  name: string
  loc: Location | undefined
  isMainLocation: boolean
  rows: StockRow[]
  editing: boolean
  setEditing: (v: boolean) => void
  counting: boolean
  setCounting: (v: boolean) => void
  variantId: string
  setVariantId: (v: string) => void
  qty: string
  setQty: (v: string) => void
  stockHere: number
  onSaveLocation: (d: { name: string; type: Location['type']; parentId?: string }) => void
  onToggleActive: () => void
  onSaveCount: () => void
}

/**
 * The desktop location screen: a toolbar with the actions the phone screen keeps in a footer/header row (edit,
 * switch on/off, set a count), a KPI strip for what this place holds, and a dense grid of its stock instead of a
 * card list. Every row (`rows` = `stockAtLocationRows`) and handler is passed down from
 * `src/app/m/warehouse/locations/[id].tsx` exactly as the phone screen computes it; the edit and count sheets are
 * reused unchanged.
 */
export function DesktopLocationDetail({ id, name, loc, isMainLocation, rows, editing, setEditing, counting, setCounting, variantId, setVariantId, qty, setQty, stockHere, onSaveLocation, onToggleActive, onSaveCount }: DesktopLocationDetailProps) {
  const { c } = useTheme()

  const totalUnits = rows.reduce((s, r) => s + r.qty, 0)
  const totalValue = rows.reduce((s, r) => s + r.value, 0)

  const columns: Array<Column<StockRow>> = [
    { key: 'name', label: 'Item', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sku}</T>
      </View>
    ) },
    { key: 'qty', label: 'Qty here', width: 110, align: 'right', sortValue: (r) => r.qty, render: (r) => cellNum(String(r.qty), true) },
    { key: 'value', label: 'Value at cost', width: 140, align: 'right', sortValue: (r) => r.value, render: (r) => cellNum(inr0(r.value)) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={name}
          subtitle={isMainLocation ? 'Stock that is not at any other place' : loc?.active ? undefined : 'Switched off'}
          right={!isMainLocation ? (
            <>
              <DeskButton label="Edit" onPress={() => setEditing(true)} />
              <DeskButton label={loc?.active ? 'Switch off' : 'Switch on'} onPress={onToggleActive} />
              <DeskButton label="Set a count" tone="primary" onPress={() => setCounting(true)} />
            </>
          ) : undefined}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Items" value={String(rows.length)} delta={`${totalUnits} units in all`} />
        <KpiTile label="Value at cost" value={inr0(totalValue)} tone="primary" />
      </KpiStrip>

      <View style={{ flex: 1, margin: 14, marginTop: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows.map((r) => ({ ...r, id: r.variantId }))} columns={columns} emptyLabel="Nothing here yet" />
      </View>

      <LocationSheet visible={editing} onClose={() => setEditing(false)} existing={loc} onSave={onSaveLocation} />
      <Sheet visible={counting} onClose={() => setCounting(false)} title="Count at this place" subtitle="How many are here right now? The item's total changes by the difference."
        footer={<DeskButton label="Save count" tone="primary" onPress={onSaveCount} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <ItemField label="Item" value={variantId} onChange={setVariantId} />
          {variantId ? <T v="caption" tone="mute">Now {stockHere} here</T> : null}
          <NumberField label="Quantity here" value={qty} onChange={setQty} decimals />
        </View>
      </Sheet>
    </DeskPage>
  )
}
