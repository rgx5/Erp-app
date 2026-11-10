import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { labelYMD, ymdOf } from '@/modules/hr/logic/ymd'
import type { Employee, HrDecision, LeaveRequest, LeaveType } from '@/modules/hr/types'
import type { LeaveBalance } from '@/modules/hr/logic/leave'
import { Button } from '@/ui/Button'
import { Field, Select } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { T } from '@/ui/Text'
import { Plus } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DataTable, DeskButton, DeskPage, DeskSegmented, KpiStrip, KpiTile, Pill, Toolbar, cellNum, cellText, dtext, type Column } from './kit'

type Tab = 'requests' | 'balances'
type Row = { id: string; name: string; meta: string; dates: string; reason: string; status: string; note?: string; raw: LeaveRequest }

export interface DesktopLeaveProps {
  tab: Tab; setTab: (v: Tab) => void
  rows: Array<{ r: LeaveRequest; status: string; dec?: HrDecision | null; typeName: string; employeeName: string }>
  isHr: boolean
  empId: string; setEmpId: (v: string) => void
  employees: Employee[]
  emp: Employee | undefined
  balances: Array<{ type: LeaveType; balance: LeaveBalance }>
  types: LeaveType[]
  now: number
  grant: boolean; setGrant: (v: boolean) => void
  gType: string; setGType: (v: string) => void
  gDays: string; setGDays: (v: string) => void
  gReason: string; setGReason: (v: string) => void
  onDecide: (id: string, decision: 'approved' | 'rejected' | 'cancelled') => void
  onOpenGrant: () => void
  onSaveGrant: () => void
  onNew: () => void
  onOpenTypes: () => void
}

/**
 * The desktop Leave screen: requests and balances as a toggle with a dense grid of requests (approve/reject
 * inline), or the chosen person's balances — instead of the phone's stack of cards. The "adjust leave" sheet is the
 * unchanged phone `Sheet`, just reached from this grid.
 */
export function DesktopLeave(p: DesktopLeaveProps) {
  const { c } = useTheme()
  const router = useRouter()
  const today = ymdOf(p.now)

  const rows: Row[] = p.rows.map(({ r, status, dec, typeName, employeeName }) => ({
    id: r.id, name: employeeName, meta: `${r.no} · ${typeName} · ${r.days} ${r.days === 1 ? 'day' : 'days'}${r.half ? ` (${r.half} half)` : ''}`,
    dates: r.from === r.to ? labelYMD(r.from) : `${labelYMD(r.from)} to ${labelYMD(r.to)}`, reason: r.reason, status, note: dec?.note ?? undefined, raw: r,
  }))

  const columns: Array<Column<Row>> = [
    { key: 'name', label: 'Employee', sortValue: (r) => r.name, render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.meta}</T>
      </View>
    ) },
    { key: 'dates', label: 'Dates', width: 180, render: (r) => cellText(r.dates) },
    { key: 'reason', label: 'Reason', render: (r) => <T style={dtext.cell} numberOfLines={2}>{r.reason || '—'}</T> },
    { key: 'status', label: 'Status', width: 110, sortValue: (r) => r.status, render: (r) => <Pill tone={r.status === 'approved' ? 'success' : r.status === 'pending' ? 'warning' : 'default'} label={r.status === 'pending' ? 'Waiting' : r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Cancelled'} /> },
    { key: 'actions', label: '', width: 190, render: (r) => (
      p.isHr && r.status === 'pending' ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <DeskButton label="Reject" onPress={() => p.onDecide(r.id, 'rejected')} />
          <DeskButton label="Approve" tone="primary" onPress={() => p.onDecide(r.id, 'approved')} />
        </View>
      ) : p.isHr && r.status === 'approved' && r.raw.to >= today ? (
        <DeskButton label="Cancel" onPress={() => p.onDecide(r.id, 'cancelled')} />
      ) : null
    ) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title="Leave"
          right={<DeskButton label="Ask" tone="primary" icon={<Plus size={14} color={c.onPrimary} />} onPress={p.onNew} />}
        />
      }
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <DeskSegmented<Tab> value={p.tab} onChange={p.setTab} options={[{ id: 'requests', label: 'Requests' }, { id: 'balances', label: 'Balances' }]} />
        {p.tab === 'balances' && p.isHr ? (
          <View style={{ width: 220 }}><Select label="" value={p.empId} onChange={p.setEmpId} placeholder="Choose a person" options={p.employees.map((e) => ({ value: e.id, label: e.name }))} /></View>
        ) : null}
        <View style={{ flex: 1 }} />
        {p.tab === 'balances' && p.isHr ? (
          <>
            <DeskButton label="Leave types" onPress={p.onOpenTypes} />
            {p.emp && p.types.length ? <DeskButton label="Add / take off days" onPress={p.onOpenGrant} /> : null}
          </>
        ) : null}
      </View>

      {p.tab === 'requests' ? (
        <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No leave requests" />
        </View>
      ) : (
        <View style={{ flex: 1, marginHorizontal: 14, marginBottom: 14 }}>
          {p.emp ? (
            p.balances.length ? (
              <View style={{ backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden', maxWidth: 640 }}>
                <DataTable
                  rows={p.balances.map((b) => ({ id: b.type.id, name: b.type.name, value: b.balance.unlimited ? `${b.balance.taken} taken` : `${b.balance.balance} left`, sub: b.balance.unlimited ? 'No balance — unpaid' : `${b.balance.opening ? `${b.balance.opening} carried · ` : ''}${b.balance.accrued} earned${b.balance.granted ? ` · ${b.balance.granted > 0 ? '+' : ''}${b.balance.granted} added` : ''} · ${b.balance.taken} taken${b.balance.pending ? ` · ${b.balance.pending} waiting` : ''}` }))}
                  columns={[
                    { key: 'name', label: 'Leave type', render: (r) => (
                      <View style={{ gap: 1 }}>
                        <T style={dtext.cellStrong} numberOfLines={1}>{r.name}</T>
                        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{r.sub}</T>
                      </View>
                    ) },
                    { key: 'value', label: 'Balance', width: 120, align: 'right', render: (r) => cellNum(r.value, true) },
                  ]}
                />
              </View>
            ) : <T tone="mute">No leave types yet. Set up casual, sick and earned leave first.</T>
          ) : <T tone="mute">{p.isHr ? 'Choose a person.' : 'You are not on the staff list yet.'}</T>}
        </View>
      )}

      <Sheet visible={p.grant} onClose={() => p.setGrant(false)} title="Adjust leave" subtitle={p.emp?.name}
        footer={<View style={{ padding: 16 }}><Button label="Save" size="lg" block onPress={p.onSaveGrant} /></View>}>
        <View style={{ gap: 14, paddingBottom: 12 }}>
          <Select label="Leave type" value={p.gType} onChange={p.setGType} options={p.types.map((t) => ({ value: t.id, label: t.name }))} />
          <Field label="Days (negative to take off)" value={p.gDays} onChangeText={p.setGDays} keyboardType="numbers-and-punctuation" placeholder="2" />
          <Field label="Reason" value={p.gReason} onChangeText={p.setGReason} placeholder="Opening balance, comp-off for Sunday work…" />
        </View>
      </Sheet>
    </DeskPage>
  )
}
