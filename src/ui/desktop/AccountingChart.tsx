import React from 'react'
import { ScrollView, View } from 'react-native'
import { inr } from '@/domain/money'
import type { Account, AccountType } from '@/modules/accounting/types'
import { Button } from '@/ui/Button'
import { Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

export interface ChartSection { type: AccountType; title: string; data: Account[] }
type Row = Account & { id: string; balance: number }

export interface DesktopChartProps {
  persisted: boolean
  sections: ChartSection[]
  missing: number
  balanceOf: (a: Account) => number
  onSeed: () => void
  onSyncExpenseAccounts: () => void
  onNewAccount: () => void
  onEditAccount: (a: Account) => void
  onOpenLedger: (id: string) => void
  total: number
}

/**
 * The desktop chart of accounts: one labelled panel per account type (assets, liabilities, equity, income,
 * expenses — `TYPE_ORDER`), each a dense grid, in a scrolling column. The hand-off to the exact mobile logic
 * (`saveAccount`/`deleteAccount`/`seedChart`/`syncExpenseAccounts`) lives entirely in `chart.tsx`; this file only
 * re-lays its sections out as grids instead of a `SectionList` and opens the same edit `Sheet` on a row press.
 */
export function DesktopChart({ persisted, sections, missing, balanceOf, onSeed, onSyncExpenseAccounts, onNewAccount, onEditAccount, onOpenLedger, total }: DesktopChartProps) {
  const { c } = useTheme()
  return (
    <DeskPage
      toolbar={
        <Toolbar title="Chart of accounts" subtitle={persisted ? `${total} accounts` : 'Not set up yet'}
          right={persisted ? <DeskButton label="New account" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={onNewAccount} /> : undefined} />
      }
    >
      {!persisted ? (
        <View style={{ padding: 20, gap: 12 }}>
          <Notice tone="primary" title="The books already work" body="Sales, purchases and expenses are posted to a standard chart. Save it to rename accounts, add your own and enter opening balances." />
          <View style={{ width: 280 }}><Button label="Set up the chart of accounts" block onPress={onSeed} /></View>
        </View>
      ) : missing ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
          <Notice tone="warning" title={`${missing} expense ${missing === 1 ? 'category has' : 'categories have'} no account`} body="Until they do, those expenses sit in Suspense." action="Add accounts" onAction={onSyncExpenseAccounts} />
        </View>
      ) : null}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
        {sections.length === 0 ? (
          <View style={{ padding: 20, alignItems: 'center' }}><T style={[dtext.cell, { color: c.inkMute }]}>No accounts</T></View>
        ) : sections.map((section) => {
          const rows: Row[] = section.data.map((a) => ({ ...a, balance: balanceOf(a) }))
          const columns: Array<Column<Row>> = [
            { key: 'code', label: 'No.', width: 80, sortValue: (r) => r.code, render: (r) => cellText(r.code) },
            { key: 'name', label: 'Account', sortValue: (r) => r.name, render: (r) => (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
                {!r.active ? <Pill label="Off" /> : null}
                {r.system ? <Pill tone="primary" label="Built in" /> : null}
              </View>
            ) },
            { key: 'balance', label: 'Balance', width: 140, align: 'right', sortValue: (r) => r.balance, render: (r) => cellNum(r.balance ? inr(r.balance, 2) : '—', !!r.balance) },
          ]
          return (
            <View key={section.type} style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 12, height: 30, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: c.line, backgroundColor: c.surfaceAlt }}>
                <T style={dtext.label}>{section.title.toUpperCase()}</T>
              </View>
              <DataTable rows={rows} columns={columns} compact onRowPress={(r) => (persisted ? onEditAccount(r) : onOpenLedger(r.id))} emptyLabel="None" />
            </View>
          )
        })}
      </ScrollView>
    </DeskPage>
  )
}
