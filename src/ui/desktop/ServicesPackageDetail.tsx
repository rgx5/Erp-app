import React from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDate, fmtDateTime } from '@/domain/dates'
import { inr } from '@/domain/money'
import { Button } from '@/ui/Button'
import { Field } from '@/ui/Inputs'
import { Sheet } from '@/ui/Sheet'
import { Badge, Card } from '@/ui/primitives'
import { KV } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Pause, Play } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { packageStatus, remainingValue, sessionsLeft, STATUS_LABEL } from '@/modules/services/logic/packages'
import { PACKAGE_TONE } from '@/modules/services/ui/common'
import type { Customer } from '@/domain/types'
import type { CustomerPackage, PackageUse } from '@/modules/services/types'
import { DataTable, DeskButton, DeskPage, dtext, KpiStrip, KpiTile, SplitPane, Toolbar, cellNum, type Column } from './kit'

const USE_LABEL = { use: 'Used', reversal: 'Given back', expiry: 'Lapsed' } as const
type Row = PackageUse & { id: string }

export interface DesktopPackageDetailProps {
  p: CustomerPackage; customer: Customer | undefined; uses: PackageUse[]; now: number; manager: boolean; reversibleIds: Set<string>
  freeze: (v: boolean) => void; lapse: () => void
  note: string; setNote: (v: string) => void; freezing: boolean | null; setFreezing: (v: boolean | null) => void
  reverseId: string | null; setReverseId: (v: string | null) => void; reason: string; setReason: (v: string) => void; reverse: () => void
}

/**
 * The desktop package screen: a KPI strip for sessions left and money, a grid of every session used, and a side
 * panel for the customer and freeze/lapse actions — the same `freeze`/`lapse`/`reverse` handlers the phone
 * `m/services/packages/[id].tsx` already holds.
 */
export function DesktopPackageDetail(p: DesktopPackageDetailProps) {
  const { c } = useTheme()
  const router = useRouter()
  const { p: pkg, now } = p
  const status = packageStatus(pkg, now)

  const rows: Row[] = p.uses as Row[]
  const columns: Array<Column<Row>> = [
    { key: 'kind', label: 'Session', sortValue: (r) => USE_LABEL[r.kind], render: (r) => (
      <View style={{ gap: 1 }}>
        <T style={dtext.cellStrong} numberOfLines={1}>{USE_LABEL[r.kind]}{r.serviceName ? ` · ${r.serviceName}` : ''}</T>
        <T style={[dtext.tiny, { color: c.inkMute }]} numberOfLines={1}>{fmtDateTime(r.date)}{r.note ? ` · ${r.note}` : ''}</T>
      </View>
    ) },
    { key: 'sessions', label: 'Sessions', width: 110, align: 'right', sortValue: (r) => r.sessions, render: (r) => cellNum(r.sessions > 0 ? `+${r.sessions}` : String(r.sessions)) },
  ]

  return (
    <DeskPage
      toolbar={
        <Toolbar
          title={pkg.name}
          subtitle={`${pkg.no}${p.customer ? ` · ${p.customer.name}` : ''}`}
          right={(
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {p.manager && status === 'active' ? <DeskButton label="Freeze" icon={<Pause size={14} color={c.ink} />} onPress={() => { p.setNote(''); p.setFreezing(true) }} /> : null}
              {p.manager && status === 'frozen' ? <DeskButton label="Unfreeze" tone="primary" icon={<Play size={14} color={c.onPrimary} />} onPress={() => p.freeze(false)} /> : null}
              {status === 'expired' && pkg.status !== 'expired' && sessionsLeft(pkg) > 0 ? <DeskButton label="Let it lapse" onPress={() => void p.lapse()} /> : null}
            </View>
          )}
        />
      }
    >
      <KpiStrip>
        <KpiTile label="Sessions left" value={`${sessionsLeft(pkg)} of ${pkg.sessions}`} tone="primary" />
        <KpiTile label="Status" value={STATUS_LABEL[status]} tone={PACKAGE_TONE[status]} />
        <KpiTile label="Still to earn" value={inr(remainingValue(pkg), 0)} tone="success" />
      </KpiStrip>

      <SplitPane widths={['flex', 320]}>
        <View style={{ flex: 1, margin: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.line, borderRadius: 8, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} emptyLabel="No sessions used yet" />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 14 }}>
          <Card>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}><Badge tone={PACKAGE_TONE[status]}>{STATUS_LABEL[status]}</Badge></View>
            <View style={{ marginTop: 8 }}>
              {p.customer ? <KV k="Customer" v={p.customer.name} /> : null}
              <KV k="Sold on" v={fmtDate(pkg.soldAt)} />
              {pkg.expiresAt !== undefined ? <KV k="Valid until" v={fmtDate(pkg.expiresAt)} tone={status === 'expired' ? 'danger' : undefined} /> : null}
              <KV k="Price paid" v={inr(pkg.price, 0)} />
              {pkg.note ? <KV k="Note" v={pkg.note} /> : null}
            </View>
          </Card>

          {p.manager && rows.some((r) => p.reversibleIds.has(r.id)) ? (
            <View style={{ gap: 8 }}>
              {rows.filter((r) => p.reversibleIds.has(r.id)).map((r) => (
                <Button key={r.id} label={`Give back · ${USE_LABEL[r.kind]}${r.serviceName ? ` · ${r.serviceName}` : ''}`} kind="ghost" size="sm" onPress={() => { p.setReason(''); p.setReverseId(r.id) }} />
              ))}
            </View>
          ) : null}

          {p.customer ? <Button label="Open the customer" kind="soft" block onPress={() => router.push({ pathname: '/customers/[id]', params: { id: p.customer!.id } } as never)} /> : null}
        </ScrollView>
      </SplitPane>

      <Sheet visible={p.freezing !== null} onClose={() => p.setFreezing(null)} title="Freeze this package" footer={<Button label="Freeze" kind="danger" size="lg" block onPress={() => p.freeze(true)} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field label="Why (optional)" value={p.note} onChangeText={p.setNote} autoCapitalize="sentences" />
          <T v="caption" tone="mute">A frozen package cannot be used until it is unfrozen. Its expiry date does not move.</T>
        </View>
      </Sheet>

      <Sheet visible={!!p.reverseId} onClose={() => p.setReverseId(null)} title="Give this session back" footer={<Button label="Confirm" kind="danger" size="lg" block onPress={p.reverse} />}>
        <View style={{ gap: 12, paddingBottom: 8 }}>
          <Field label="Why" value={p.reason} onChangeText={p.setReason} autoCapitalize="sentences" placeholder="Booking cancelled by the shop" />
        </View>
      </Sheet>
    </DeskPage>
  )
}
