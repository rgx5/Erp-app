import React from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { inr } from '@/domain/money'
import { fonts, useTheme } from '@/ui/theme'
import { Search as SearchIcon } from '@/ui/icons'
import { DataTable, DeskPage, DeskSegmented, KpiStrip, KpiTile, Toolbar, cellNum, cellText, type Column } from './kit'

export type PartyKind = 'customer' | 'supplier'
export interface PartyRow { id: string; name: string; balance: number }

export interface DesktopPartiesProps {
  kind: PartyKind
  setKind: (k: PartyKind) => void
  q: string
  setQ: (q: string) => void
  rows: PartyRow[]
  total: number
}

/**
 * The desktop party-ledgers screen: a KPI strip (total receivable/payable), a search bar with a Customers/Suppliers
 * toggle, and one dense sortable grid — the desktop twin of `DesktopPurchases`. Every row's balance is exactly what
 * `src/app/m/accounting/parties/index.tsx` already computes with `partyBalances`; this file only lays it out as a grid.
 */
export function DesktopParties({ kind, setKind, q, setQ, rows, total }: DesktopPartiesProps) {
  const { c } = useTheme()
  const router = useRouter()

  const columns: Array<Column<PartyRow>> = [
    { key: 'name', label: kind === 'customer' ? 'Customer' : 'Supplier', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'balance', label: kind === 'customer' ? 'Owes us' : 'We owe', width: 160, align: 'right', sortValue: (r) => r.balance, render: (r) => cellNum(inr(r.balance, 2), true) },
  ]

  return (
    <DeskPage toolbar={<Toolbar title="Party ledgers" subtitle={`${rows.length} ${kind === 'customer' ? 'customers' : 'suppliers'}`} />}>
      <KpiStrip>
        <KpiTile label={kind === 'customer' ? 'Total receivable' : 'Total payable'} value={inr(total, 2)} tone={total ? (kind === 'customer' ? 'primary' : 'warning') : 'success'} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search by name"
            placeholderTextColor={c.inkMute}
            autoCorrect={false}
            autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
          />
        </View>
        <DeskSegmented<PartyKind> value={kind} onChange={setKind} options={[{ id: 'customer', label: 'Customers' }, { id: 'supplier', label: 'Suppliers' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable
          rows={rows}
          columns={columns}
          onRowPress={(r) => router.push({ pathname: '/m/accounting/parties/[type]/[id]', params: { type: kind, id: r.id } })}
          emptyLabel={q ? 'No matches' : 'Nothing outstanding'}
        />
      </View>
    </DeskPage>
  )
}
