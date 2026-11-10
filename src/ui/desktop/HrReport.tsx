import React, { useMemo, useState } from 'react'
import { useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { csvFileName, toCsv } from '@/domain/csv'
import { inr } from '@/domain/money'
import { can as roleCan } from '@/domain/permissions'
import { useUser } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import {
  advancesTable, attendanceSheetTable, bankExport, claimsTable, leaveBalanceTable, payrollRegisterTable, scorecardTableFor, statutoryTable, type HrTable,
} from '@/modules/hr/logic/reports'
import { addMonths, labelYM, ymOf, ymdOf } from '@/modules/hr/logic/ymd'
import { useHr } from '@/modules/hr/ui/common'
import { T } from '@/ui/Text'
import { Download, FileText, Printer } from '@/ui/icons'
import { printHtml, sharePdf } from '@/features/share'
import { tableHtml } from '@/modules/hr/html'
import { tableCsvRows } from '@/modules/hr/logic/reports'
import { useStore } from '@/data/hooks'
import { useTheme } from '@/ui/theme'
import { HrTableGrid } from './hrShared'
import { DeskButton, DeskPage, KpiStrip, KpiTile, Toolbar } from './kit'

const KINDS: Record<string, { title: string; perm: 'hr' | 'payroll'; monthly: boolean }> = {
  attendance: { title: 'Attendance sheet', perm: 'hr', monthly: true },
  payroll: { title: 'Payroll register', perm: 'payroll', monthly: true },
  statutory: { title: 'PF, ESI, PT & TDS', perm: 'payroll', monthly: true },
  bank: { title: 'Salary bank file', perm: 'payroll', monthly: true },
  leave: { title: 'Leave balances', perm: 'hr', monthly: false },
  scorecards: { title: 'Staff scorecards', perm: 'hr', monthly: true },
  claims: { title: 'Expense claims', perm: 'hr', monthly: false },
  advances: { title: 'Advances outstanding', perm: 'payroll', monthly: false },
}

/**
 * Every desktop people report: the exact table each report builds (`attendanceSheetTable`, `payrollRegisterTable`…)
 * as a dense grid (`HrTableGrid`), with CSV / print / PDF — instead of the phone's `TableCard` + `ExportBar`. Reads
 * its own data directly, exactly like `DesktopPurchases`.
 */
export function DesktopHrReport() {
  const { c } = useTheme()
  const { kind } = useLocalSearchParams<{ kind: string }>()
  const def = KINDS[kind]
  const user = useUser()
  const { data, now } = useHr()
  const store = useStore()
  const [month, setMonth] = useState(ymOf(now))
  const allowed = !!def && roleCan(user?.role, def.perm)
  const bank = useMemo(() => (allowed && kind === 'bank' ? bankExport(data, month) : null), [allowed, kind, data, month])
  const table: HrTable | null = useMemo(() => {
    if (!allowed) return null
    switch (kind) {
      case 'attendance': return attendanceSheetTable(data, month, now)
      case 'payroll': return payrollRegisterTable(data, month)
      case 'statutory': return statutoryTable(data, month)
      case 'leave': return leaveBalanceTable(data, ymdOf(now))
      case 'scorecards': return scorecardTableFor(data, month, now)
      case 'claims': return claimsTable(data)
      case 'advances': return advancesTable(data)
      case 'bank': return bank ? { title: `Bank file ${labelYM(month)}`, columns: bank.rows[0].map((l) => ({ label: String(l), align: l === 'Amount' ? 'right' as const : undefined })), rows: bank.rows.slice(1) } : null
      default: return null
    }
  }, [allowed, kind, data, month, now, bank])

  if (!def || !allowed || !table) {
    return (
      <DeskPage toolbar={<Toolbar title={def?.title ?? 'Report'} />}>
        <View style={{ padding: 20 }}><T tone="mute">{!def ? 'That report does not exist.' : def.perm === 'payroll' ? 'This report is for the owner and managers with payroll access.' : 'This report is for the owner and managers.'}</T></View>
      </DeskPage>
    )
  }

  const name = store?.name ?? 'OneSyncERP'

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={def.title}
          subtitle={table.subtitle}
          left={def.monthly ? <><DeskButton label="‹" onPress={() => setMonth(addMonths(month, -1))} /><DeskButton label={labelYM(month)} onPress={() => {}} disabled /><DeskButton label="›" disabled={month >= ymOf(now)} onPress={() => month < ymOf(now) && setMonth(addMonths(month, 1))} /></> : undefined}
          right={
            kind === 'bank' && bank ? (
              <DeskButton label="Bank file (CSV)" tone="primary" disabled={!bank.people} icon={<Download size={14} color={c.onPrimary} />} onPress={() => void shareFile(csvFileName(`salary-${month}`), toCsv(bank.rows))} />
            ) : table.rows.length ? (
              <>
                <DeskButton label="CSV" icon={<Download size={14} color={c.ink} />} onPress={() => void shareFile(csvFileName(table.title), toCsv(tableCsvRows(table)))} />
                <DeskButton label="Print" icon={<Printer size={14} color={c.ink} />} onPress={() => void printHtml(tableHtml(name, table))} />
                <DeskButton label="PDF" icon={<FileText size={14} color={c.ink} />} onPress={() => void sharePdf(tableHtml(name, table), csvFileName(table.title, 'pdf'))} />
              </>
            ) : undefined
          }
        />
      }
    >
      {bank?.missing.length ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 10 }}>
          <T tone="warning">{`${bank.missing.join(', ')} will be left out until their account or UPI id is added in Pay terms.`}</T>
        </View>
      ) : null}
      {bank ? (
        <KpiStrip>
          <KpiTile label="To pay" value={inr(bank.total, 0)} tone="primary" delta={`${bank.people} unpaid payslips`} />
        </KpiStrip>
      ) : null}

      <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
        <HrTableGrid table={table} />
      </View>
    </DeskPage>
  )
}
