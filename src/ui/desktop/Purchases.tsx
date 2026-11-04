import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { dayLabel } from '@/domain/dates'
import { inr0, inrShort } from '@/domain/money'
import { boughtSince, filterPurchases, totalPayable } from '@/domain/purchasing'
import { purchaseDue, supplierOwed } from '@/domain/stock'
import { useList } from '@/data/hooks'
import { useCan } from '@/data/store'
import { SupplierSheet } from '@/features/SupplierSheet'
import { T } from '@/ui/Text'
import { fonts, useTheme } from '@/ui/theme'
import { Plus, Search as SearchIcon, UserPlus } from '@/ui/icons'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Tab = 'receipts' | 'suppliers'

type ReceiptRow = { id: string; no: string; invoiceRef: string; date: number; supplierName: string; lines: number; total: number; due: number }
type SupplierRow = { id: string; name: string; phone: string; gstin: string; count: number; owed: number }

/**
 * The desktop Purchases screen: a KPI strip (what's owed, this month's buying), a search bar with a Receipts/
 * Suppliers toggle, and one dense sortable grid per tab — instead of the phone's two scrolling card lists. Every
 * figure comes from the exact functions the phone `purchases/index.tsx` already computes (`filterPurchases`,
 * `totalPayable`, `boughtSince`, `supplierOwed`, `purchaseDue`); this file only lays the same rows out as a grid.
 */
export function DesktopPurchases() {
  const { c } = useTheme()
  const router = useRouter()
  const canBuy = useCan('purchases')
  const purchases = useList('purchases')
  const suppliers = useList('suppliers')
  const [tab, setTab] = useState<Tab>('receipts')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)

  const name = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers])
  const receipts = useMemo(() => filterPurchases(purchases, q, (id) => name.get(id) ?? ''), [purchases, q, name])
  const parties = useMemo(() => {
    const n = q.trim().toLowerCase()
    return suppliers
      .filter((s) => !n || s.name.toLowerCase().includes(n) || s.phone.includes(n) || s.gstin.toLowerCase().includes(n))
      .map((s) => ({ s, owed: supplierOwed(s, purchases), count: purchases.filter((p) => p.supplierId === s.id).length }))
      .sort((a, b) => b.owed - a.owed || a.s.name.localeCompare(b.s.name))
  }, [suppliers, purchases, q])
  const payable = useMemo(() => totalPayable(suppliers, purchases), [suppliers, purchases])
  const month = useMemo(() => { const d = new Date(); return boughtSince(purchases, new Date(d.getFullYear(), d.getMonth(), 1).getTime()) }, [purchases])

  const receiptRows: ReceiptRow[] = useMemo(() => receipts.map((p) => ({
    id: p.id, no: p.no, invoiceRef: p.invoiceRef, date: p.date, supplierName: name.get(p.supplierId) ?? 'Supplier', lines: p.items.length, total: p.total, due: purchaseDue(p),
  })), [receipts, name])
  const supplierRows: SupplierRow[] = useMemo(() => parties.map(({ s, owed, count }) => ({ id: s.id, name: s.name, phone: s.phone, gstin: s.gstin, count, owed })), [parties])

  if (!canBuy) {
    return (
      <DeskPage toolbar={<Toolbar title="Purchases" />}>
        <View style={{ padding: 20 }}><T tone="mute">Purchases are for the owner and managers.</T></View>
      </DeskPage>
    )
  }

  const receiptColumns: Array<Column<ReceiptRow>> = [
    { key: 'supplier', label: 'Supplier', sortValue: (r) => r.supplierName, render: (r) => cellText(r.supplierName, true) },
    { key: 'no', label: 'Receipt', width: 180, sortValue: (r) => r.no, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cell} numberOfLines={1}>{r.no}</T>
        {r.invoiceRef ? <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>Bill {r.invoiceRef}</T> : null}
      </View>
    ) },
    { key: 'date', label: 'Date', width: 110, sortValue: (r) => r.date, render: (r) => cellText(dayLabel(r.date)) },
    { key: 'lines', label: 'Lines', width: 70, align: 'right', sortValue: (r) => r.lines, render: (r) => cellNum(String(r.lines)) },
    { key: 'total', label: 'Total', width: 120, align: 'right', sortValue: (r) => r.total, render: (r) => cellNum(inr0(r.total), true) },
    { key: 'status', label: 'Status', width: 130, sortValue: (r) => r.due, render: (r) => (r.due > 0 ? <Pill tone="warning" label={`Due ${inr0(r.due)}`} /> : <Pill tone="success" label="Paid" />) },
  ]

  const supplierColumns: Array<Column<SupplierRow>> = [
    { key: 'name', label: 'Supplier', sortValue: (r) => r.name, render: (r) => cellText(r.name, true) },
    { key: 'phone', label: 'Phone', width: 140, sortValue: (r) => r.phone, render: (r) => cellText(r.phone || '—') },
    { key: 'gstin', label: 'GSTIN', width: 160, sortValue: (r) => r.gstin, render: (r) => cellText(r.gstin || '—') },
    { key: 'count', label: 'Receipts', width: 90, align: 'right', sortValue: (r) => r.count, render: (r) => cellNum(String(r.count)) },
    { key: 'owed', label: 'Owed', width: 140, align: 'right', sortValue: (r) => r.owed, render: (r) => (
      r.owed > 0 ? cellNum(inr0(r.owed), true) : r.owed < 0 ? <Pill tone="accent" label={`${inr0(-r.owed)} advance`} /> : cellText('Settled')
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Purchases"
          subtitle={`${purchases.length} receipts · ${suppliers.length} suppliers`}
          right={
            tab === 'receipts'
              ? <DeskButton label="Receive stock" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/purchases/new')} />
              : <DeskButton label="Add supplier" tone="primary" icon={<UserPlus size={14} color={c.onPrimary} />} onPress={() => setAdding(true)} />
          }
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Owed" value={inrShort(payable)} tone={payable ? 'warning' : 'success'} delta={payable ? `${parties.filter((p) => p.owed > 0).length} to pay` : 'All settled'} onPress={() => setTab('suppliers')} />
        <KpiTile label="This month" value={inrShort(month)} tone="primary" delta={`${purchases.length} receipts in all`} />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, maxWidth: 320, flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={tab === 'receipts' ? 'Search receipt, bill no. or supplier' : 'Search suppliers'}
            placeholderTextColor={c.inkMute}
            autoCorrect={false}
            autoCapitalize="none"
            style={{ flex: 1, minWidth: 0, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }}
          />
        </View>
        <DeskSegmented<Tab> value={tab} onChange={(t) => { setTab(t); setQ('') }} options={[{ id: 'receipts', label: 'Receipts' }, { id: 'suppliers', label: 'Suppliers' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        {tab === 'receipts' ? (
          <DataTable
            rows={receiptRows}
            columns={receiptColumns}
            onRowPress={(r) => router.push({ pathname: '/purchases/[id]', params: { id: r.id } })}
            emptyLabel={q ? 'No receipts match' : 'No receipts yet'}
          />
        ) : (
          <DataTable
            rows={supplierRows}
            columns={supplierColumns}
            onRowPress={(r) => router.push({ pathname: '/suppliers/[id]', params: { id: r.id } })}
            emptyLabel={q ? 'No suppliers match' : 'No suppliers yet'}
          />
        )}
      </View>

      <SupplierSheet visible={adding} onClose={() => setAdding(false)} onSaved={(s) => router.push({ pathname: '/suppliers/[id]', params: { id: s.id } })} />
    </DeskPage>
  )
}
