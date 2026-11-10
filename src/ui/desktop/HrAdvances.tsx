import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useCan } from '@/data/store'
import { advanceStandings } from '@/modules/hr/logic/advances'
import { useHr } from '@/modules/hr/ui/common'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Tab = 'open' | 'settled'
type Row = { id: string; name: string; no: string; date: number; amount: number; kind: 'advance' | 'loan'; installments: number; balance: number }

/** The desktop advances & loans screen: a KPI for what staff owe, and a dense grid instead of a scrolling list. */
export function DesktopAdvances() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('payroll')
  const { data } = useHr()
  const [tab, setTab] = useState<Tab>('open')
  const list = useMemo(() => advanceStandings(data), [data])
  const shown = list.filter((s) => (tab === 'open' ? s.balance > 0 : s.balance === 0))
  const owed = list.reduce((t, s) => t + s.balance, 0)

  if (!can) {
    return (
      <DeskPage toolbar={<Toolbar title="Advances & loans" />}>
        <View style={{ padding: 20 }}><T tone="mute">Advances are for the owner and managers with payroll access.</T></View>
      </DeskPage>
    )
  }

  const rows: Row[] = shown.map((s) => ({
    id: s.advance.id, name: data.employees?.[s.advance.employeeId]?.name ?? 'Former staff', no: s.advance.no, date: s.advance.date,
    amount: s.advance.amount, kind: s.advance.kind, installments: s.advance.installments, balance: s.balance,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Employee', sortValue: (r) => r.name, render: (r) => (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        {r.kind === 'loan' ? <Pill tone="accent" label="Loan" /> : null}
      </View>
    ) },
    { key: 'no', label: 'No.', width: 140, sortValue: (r) => r.no, render: (r) => cellText(r.no) },
    { key: 'date', label: 'Date', width: 110, sortValue: (r) => r.date, render: (r) => cellText(fmtDayShort(r.date)) },
    { key: 'amount', label: 'Amount', width: 130, align: 'right', sortValue: (r) => r.amount, render: (r) => cellNum(`${inr(r.amount, 0)}${r.installments > 1 ? ` / ${r.installments}mo` : ''}`) },
    { key: 'balance', label: 'Balance', width: 120, align: 'right', sortValue: (r) => r.balance, render: (r) => cellNum(inr(r.balance, 0), true) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Advances & loans"
          subtitle={`Staff owe ${inr(owed, 0)}`}
          right={<DeskButton label="Give" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={() => router.push('/m/hr/advances/new')} />}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Staff owe the business" value={inr(owed, 0)} tone={owed ? 'warning' : 'success'} delta="Taken back from salary each month" />
      </KpiStrip>

      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 }}>
        <DeskSegmented<Tab> value={tab} onChange={setTab} options={[{ id: 'open', label: 'Open' }, { id: 'settled', label: 'Settled' }]} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <DataTable rows={rows} columns={columns} onRowPress={(r) => router.push({ pathname: '/m/hr/advances/[id]', params: { id: r.id } } as never)} emptyLabel={tab === 'open' ? 'No open advances' : 'Nothing settled yet'} />
      </View>
    </DeskPage>
  )
}
