import React, { useMemo, useState } from 'react'
import { TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan } from '@/data/store'
import { agingReport, receivables } from '@/modules/credit/logic'
import { outstandingGiftCards } from '@/modules/credit/giftcards'
import { T } from '@/ui/Text'
import { Gift, Plus, Search as SearchIcon } from '@/ui/icons'
import { fonts, useTheme } from '@/ui/theme'
import { cellNum, cellText, DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, Pill, Toolbar, type Column } from './kit'

type Row = { id: string; name: string; net: number; overdue: number; days: number; oldestDue: number | null }

/**
 * The desktop Credit & dues screen: a KPI strip (owed, overdue), the same quick links (Ageing, Reminders, Gift
 * cards) as the phone screen's button row, and one dense sortable grid of every account instead of a scrolling
 * card list. Reads its own data directly, exactly like `DesktopPurchases`: every figure comes from the same
 * `receivables`/`agingReport` the phone `m/credit/index.tsx` calls.
 */
export function DesktopCreditHome() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('collections')
  const data = useApp((s) => s.data)
  const [q, setQ] = useState('')
  const now = Date.now()

  const { rows, rep, total } = useMemo(() => {
    const rec = receivables(data)
    const rep = agingReport(data, now, rec)
    const late = new Map(rep.rows.map((r) => [r.customerId, r]))
    const rows = Object.values(rec.byCustomer).filter((d) => d.net !== 0).map((d) => {
      const r = late.get(d.customerId)
      return { ...d, name: data.customers[d.customerId]?.name ?? 'Customer', overdue: r ? Math.round((r.total - r.buckets.notDue) * 100) / 100 : 0, days: r?.oldestDaysOverdue ?? 0 }
    }).sort((a, b) => b.net - a.net)
    return { rows, rep, total: rec.total }
  }, [data, now])

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Credit & dues" />}>
        <View style={{ padding: 20 }}><T tone="mute">Credit and collections are for the owner, managers and cashiers.</T></View>
      </DeskPage>
    )
  }

  const overdue = Math.round((rep.total - rep.totals.notDue) * 100) / 100
  const cards = outstandingGiftCards(data, now)
  const shown = rows.filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()))
  const tableRows: Row[] = shown.map((r) => ({ id: r.customerId, name: r.name, net: r.net, overdue: r.overdue, days: r.days, oldestDue: r.oldestDue }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Customer', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.net < 0 ? 'Paid in advance' : r.oldestDue ? `Oldest due ${fmtDayShort(r.oldestDue)}` : ''}</T>
      </View>
    ) },
    { key: 'overdue', label: 'Overdue', width: 130, sortValue: (r) => r.overdue, render: (r) => (r.overdue > 0 ? <Pill tone="danger" label={`${r.days} ${r.days === 1 ? 'day' : 'days'}`} /> : null) },
    { key: 'net', label: 'Balance', width: 130, align: 'right', sortValue: (r) => Math.abs(r.net), render: (r) => (r.net < 0 ? cellNum(inr(Math.abs(r.net), 0)) : cellText(inr(Math.abs(r.net), 0), true)) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Credit & dues"
          subtitle={rows.length ? `${rows.length} accounts` : undefined}
          right={<DeskButton label="Collect" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/credit/collect')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Owed to you" value={inr(total, 0)} tone="primary" />
        <KpiTile label="Overdue" value={inr(overdue, 0)} tone={overdue > 0 ? 'danger' : 'success'} onPress={() => router.push('/m/credit/reminders')} />
        <KpiTile label="Gift cards" value={inr(cards.amount, 0)} delta={`${cards.cards} active`} onPress={() => router.push('/m/credit/giftcards')} />
      </KpiStrip>

      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <DeskButton label="Ageing" onPress={() => router.push('/m/credit/ageing')} />
        <DeskButton label="Reminders" onPress={() => router.push('/m/credit/reminders')} />
        <DeskButton label="Gift cards" icon={<Gift size={13} color={c.ink} />} onPress={() => router.push('/m/credit/giftcards')} />
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: c.lineStrong, backgroundColor: c.surface, maxWidth: 300 }}>
          <SearchIcon size={14} color={c.inkMute} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search customer" placeholderTextColor={c.inkMute} autoCorrect={false} autoCapitalize="none" style={{ minWidth: 160, color: c.ink, fontFamily: fonts.body, fontSize: 12.5, paddingVertical: 0, outlineWidth: 0 }} />
        </View>
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={tableRows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/credit/customer/[id]', params: { id: r.id } })} emptyLabel={q ? 'No one matches' : 'No one owes you anything'} />
      </View>
    </DeskPage>
  )
}
