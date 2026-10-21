import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { csvFileName, toCsv } from '@/domain/csv'
import { inr } from '@/domain/money'
import { can as roleCan } from '@/domain/permissions'
import { useUser } from '@/data/store'
import { shareFile } from '@/features/shareFile'
import {
  advancesTable, attendanceSheetTable, bankExport, claimsTable, leaveBalanceTable, payrollRegisterTable, scorecardTableFor, statutoryTable, type HrTable,
} from '@/modules/hr/logic/reports'
import { labelYM, ymOf, ymdOf } from '@/modules/hr/logic/ymd'
import { Denied, ExportBar, MonthBar, TableCard, useHr } from '@/modules/hr/ui/common'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Notice } from '@/ui/blocks'
import { Download } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

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

/** Every people report: a table on the screen, exportable as CSV, a print or a PDF. */
export default function HrReport() {
  const { c } = useTheme()
  const { kind } = useLocalSearchParams<{ kind: string }>()
  const def = KINDS[kind]
  const user = useUser()
  const { data, now } = useHr()
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

  if (!def) return <Denied title="Report" who="That report does not exist." />
  if (!allowed || !table) return <Denied title={def.title} who={def.perm === 'payroll' ? 'This report is for the owner and managers with payroll access.' : 'This report is for the owner and managers.'} />
  return (
    <Screen title={def.title} subtitle={table.subtitle} back>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        {def.monthly ? <MonthBar month={month} onChange={setMonth} /> : null}
        {bank?.missing.length ? <Notice tone="warning" title="No bank details" body={`${bank.missing.join(', ')} will be left out until their account or UPI id is added in Pay terms.`} /> : null}
        {bank ? <Notice tone="primary" title={`${bank.people} to pay · ${inr(bank.total, 0)}`} body="Unpaid payslips only. Banks use different upload layouts; this has the usual columns." /> : null}
        <TableCard table={table} />
        {kind === 'bank' && bank ? <Button label="Download bank file (CSV)" block disabled={!bank.people} icon={<Download size={18} color={c.onPrimary} />} onPress={() => void shareFile(csvFileName(`salary-${month}`), toCsv(bank.rows))} /> : <ExportBar table={table} />}
      </View>
    </Screen>
  )
}
