import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate } from '@/domain/dates'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import { findSerials, serialView } from '@/modules/warehouse/logic'
import { registerSerial } from '@/modules/warehouse/ops'
import type { SerialStatus } from '@/modules/warehouse/types'
import { ItemField, useData } from '@/modules/warehouse/ui/common'
import { Button, IconButton } from '@/ui/Button'
import { Field, NumberField, SearchBar } from '@/ui/Inputs'
import { Screen } from '@/ui/Screen'
import { Sheet } from '@/ui/Sheet'
import { Badge, Group } from '@/ui/primitives'
import { EmptyState, ListRow } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { PackageSearch, Plus } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme, type Tone } from '@/ui/theme'

const STATUS: Record<SerialStatus, [string, Tone]> = { in_stock: ['In stock', 'success'], sold: ['Sold', 'primary'], returned: ['Returned', 'accent'], written_off: ['Written off', 'danger'] }

/** Serial / IMEI look-up: type or scan the number (or its last digits) to see the unit, who bought it and its warranty. */
export default function Serials() {
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
  const found = useMemo(() => (q.trim().length >= 3 ? findSerials(data, q) : [...all].sort((a, b) => (b.soldAt ?? b.receivedAt ?? 0) - (a.soldAt ?? a.receivedAt ?? 0)).slice(0, 30)), [data, all, q])
  if (!can) return <Screen title="Serial numbers" back><T tone="mute">Serial numbers are for people at the counter.</T></Screen>

  function add() {
    try {
      perform((s, ctx) => registerSerial(s, { variantId, serial, warrantyMonths: Number(months) || undefined }, ctx))
      toast('Serial number added', 'ok'); setAdding(false); setSerial(''); setMonths('')
    } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
  }

  return (
    <Screen title="Serial numbers" subtitle="IMEI look-up and warranty" back
      right={canEdit ? <IconButton label="Add serial number" tone="dark" onPress={() => setAdding(true)}><Plus size={22} color={c.bg} /></IconButton> : undefined}>
      <View style={{ gap: 14, paddingBottom: 20 }}>
        <SearchBar value={q} onChange={setQ} placeholder="Serial or IMEI — or its last digits" />
        {found.length ? (
          <Group>
            {found.map((s) => {
              const v = serialView(data, s, now)
              const [label, tone] = STATUS[s.status]
              const w = v.warranty
              return (
                <ListRow key={s.id} title={s.serial} subtitle={[v.name, v.customer, s.billNo].filter(Boolean).join(' · ')}
                  meta={s.warrantyUntil && s.status === 'sold' ? (w.kind === 'active' ? `Warranty to ${fmtDate(s.warrantyUntil)} (${w.days} days left)` : `Warranty ended ${fmtDate(s.warrantyUntil)}`) : undefined}
                  badge={<Badge tone={tone}>{label}</Badge>} onPress={() => router.push({ pathname: '/m/warehouse/serials/[id]', params: { id: s.id } })} />
              )
            })}
          </Group>
        ) : <EmptyState icon={<PackageSearch size={26} color={c.primary} />} title={q.trim().length >= 3 ? 'No unit found' : 'No serial numbers yet'} hint={q.trim().length >= 3 ? 'Check the number, or try the last few digits.' : 'Turn on serial tracking for an item (Tracking rules); the numbers are captured when goods arrive and when they are sold.'} />}
      </View>
      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a serial number" subtitle="For a unit you already hold. Stock does not change." footer={<Button label="Add" size="lg" block onPress={add} />}>
        <View style={{ gap: 14, paddingBottom: 8 }}>
          <ItemField label="Item" value={variantId} onChange={setVariantId} />
          <Field label="Serial / IMEI" value={serial} onChangeText={setSerial} autoCapitalize="characters" />
          <NumberField label="Warranty (months, optional)" value={months} onChange={setMonths} />
        </View>
      </Sheet>
    </Screen>
  )
}
