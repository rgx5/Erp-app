import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { findSerials, serialView } from '@/modules/warehouse/logic'
import { registerSerial } from '@/modules/warehouse/ops'
import type { Serial, SerialStatus } from '@/modules/warehouse/types'
import { ItemField, useData } from '@/modules/warehouse/ui/common'
import { Field, NumberField } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { fonts, useTheme, type Tone } from '@/ui/theme'
import { Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { DataTable, DeskButton, DeskPage, KpiStrip, KpiTile, Pill, Toolbar, cellText, type Column } from './kit'

const STATUS: Record<SerialStatus, [string, Tone]> = { in_stock: ['In stock', 'success'], sold: ['Sold', 'primary'], returned: ['Returned', 'accent'], written_off: ['Written off', 'danger'] }

/**
 * The desktop Serials screen: a KPI strip for how many units are on the shelf vs. sold, a search box in place of
 * the phone's `SearchBar`, and a dense grid of units instead of a card list. Reads the exact same
 * `findSerials`/`serialView` the phone screen uses; this file only lays the same rows out as a grid, and reuses
 * the "Add a serial number" `Sheet` unchanged.
 */
export function DesktopSerials() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('pos')
  const canEdit = useCan('warehouse')
  const data = useData()
  const all = useList('serials')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [variantId, setVariantId] = useState('')
  const [serial, setSerial] = useState('')
  const [months, setMonths] = useState('')
  const now = Date.now()
  const found = useMemo(() => (q.trim().length >= 3 ? findSerials(data, q) : [...all].sort((a, b) => (b.soldAt ?? b.receivedAt ?? 0) - (a.soldAt ?? a.receivedAt ?? 0)).slice(0, 60)), [data, all, q])
  const inStock = useMemo(() => all.filter((s) => s.status === 'in_stock').length, [all])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Serial numbers" />}>
        <View style={{ padding: 20 }}><T tone="mute">Serial numbers are for people at the counter.</T></View>
      </DeskPage>
    )
  }

  function add() {
    try {
      perform((s, ctx) => registerSerial(s, { variantId, serial, warrantyMonths: Number(months) || undefined }, ctx))
      toast('Serial number added', 'ok'); setAdding(false); setSerial(''); setMonths('')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  const columns: Array<Column<Serial>> = [
    { key: 'serial', label: 'Serial / IMEI', sortValue: (s) => s.serial, render: (s) => cellText(s.serial, true) },
    { key: 'item', label: 'Item', render: (s) => {
      const v = serialView(data, s, now)
      return cellText([v.name, v.customer, s.billNo].filter(Boolean).join(' · '))
    } },
    { key: 'status', label: 'Status', width: 120, sortValue: (s) => s.status, render: (s) => <Pill tone={STATUS[s.status][1]} label={STATUS[s.status][0]} /> },
    { key: 'warranty', label: 'Warranty', width: 220, render: (s) => {
      const v = serialView(data, s, now)
      if (!(s.warrantyUntil && s.status === 'sold')) return cellText('—')
      return cellText(v.warranty.kind === 'active' ? `To ${fmtDate(s.warrantyUntil)} (${v.warranty.days} days left)` : `Ended ${fmtDate(s.warrantyUntil)}`)
    } },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Serial numbers"
          subtitle="IMEI look-up and warranty"
          left={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 30, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.bg }}>
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Serial or IMEI — or its last digits"
                placeholderTextColor={c.inkMute}
                autoCorrect={false}
                autoCapitalize="none"
                style={{ width: 260, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
              />
            </View>
          }
          right={canEdit ? <DeskButton label="Add serial number" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => setAdding(true)} /> : undefined}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Tracked units" value={String(all.length)} delta={`${inStock} in stock`} />
      </KpiStrip>

      <View style={{ flex: 1, margin: 14, marginTop: 10, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={found}
          columns={columns}
          onRowPress={(s) => router.push({ pathname: '/m/warehouse/serials/[id]', params: { id: s.id } })}
          emptyLabel={q.trim().length >= 3 ? 'No unit found' : 'No serial numbers yet'}
        />
      </View>

      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a serial number" subtitle="For a unit you already hold. Stock does not change." footer={<DeskButton label="Add" tone="primary" onPress={add} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <ItemField label="Item" value={variantId} onChange={setVariantId} />
          <Field label="Serial / IMEI" value={serial} onChangeText={setSerial} autoCapitalize="characters" />
          <NumberField label="Warranty (months, optional)" value={months} onChange={setMonths} />
        </View>
      </Sheet>
    </DeskPage>
  )
}
