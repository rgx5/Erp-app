import React from 'react'
import { View } from 'react-native'
import { fmtDate } from '@/domain/dates'
import type { FinancialYear, PeriodLock } from '@/modules/accounting/types'
import { Button } from '@/ui/Button'
import { Badge, Card } from '@/ui/primitives'
import { KV, Notice, Section } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Lock, Unlock } from '@/ui/icons'
import { useTheme } from '@/ui/theme'
import { DesktopSettingsPage } from './SettingsPage'

export interface DesktopYearsProps {
  through: number | null
  owner: boolean
  years: FinancialYear[]
  locks: PeriodLock[]
  onNewYear: () => void
  onEditYear: (y: FinancialYear) => void
  onCloseYear: (id: string, label: string) => void
  onDeleteYear: (id: string, label: string) => void
  onLockPeriod: () => void
  onUnlockLatest: () => void
}

/**
 * The desktop years-and-locks screen. There are rarely more than a handful of financial years or locks, so this
 * reads as a settings-style management page (the `DesktopSettingsPage` shell, the same mobile `Card`/`Badge`/`KV`
 * pieces `src/app/m/accounting/years.tsx` already renders) rather than a dense grid — the two `Sheet`s for adding a
 * year or a lock stay exactly as `years.tsx` defines them and are rendered by that file regardless of breakpoint.
 */
export function DesktopYears({ through, owner, years, locks, onNewYear, onEditYear, onCloseYear, onDeleteYear, onLockPeriod, onUnlockLatest }: DesktopYearsProps) {
  const { c } = useTheme()
  return (
    <DesktopSettingsPage title="Years & locks" maxWidth={680}>
      <Card style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {through !== null ? <Lock size={18} color={c.primary} /> : <Unlock size={18} color={c.inkMute} />}
          <T v="bodyStrong">{through !== null ? `Locked through ${fmtDate(through)}` : 'Nothing is locked'}</T>
        </View>
        <T v="caption" tone="mute">Vouchers dated on or before the lock are refused — on every phone and on the server.</T>
        {owner ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <View style={{ flex: 1 }}><Button label="Lock a period" kind="outline" block icon={<Lock size={18} color={c.ink} />} onPress={onLockPeriod} /></View>
            {locks.length ? <View style={{ flex: 1 }}><Button label="Unlock latest" kind="outline" block icon={<Unlock size={18} color={c.ink} />} onPress={onUnlockLatest} /></View> : null}
          </View>
        ) : <T v="caption" tone="warning">Only the owner can lock or unlock a period.</T>}
      </Card>

      <Section title="Financial years" action={owner ? 'Add' : undefined} onAction={onNewYear}>
        {years.length ? years.map((y) => (
          <Card key={y.id} style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T v="bodyStrong" style={{ flex: 1 }}>{y.label}</T>
              <Badge tone={y.status === 'closed' ? 'success' : 'primary'}>{y.status === 'closed' ? 'Closed' : 'Open'}</Badge>
            </View>
            <KV k="Runs" v={`${fmtDate(y.start)} – ${fmtDate(y.end)}`} />
            {y.status === 'open' && owner ? (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <View style={{ flex: 1 }}><Button label="Edit" kind="outline" block onPress={() => onEditYear(y)} /></View>
                <View style={{ flex: 1 }}><Button label="Close year" kind="danger" block onPress={() => onCloseYear(y.id, y.label)} /></View>
                <Button label="Delete" kind="ghost" onPress={() => onDeleteYear(y.id, y.label)} />
              </View>
            ) : null}
          </Card>
        )) : (
          <Notice tone="primary" title="Using the standard April – March year" body={owner ? 'Add a financial year to close it at the year end and carry the profit forward.' : 'The owner can add a financial year.'} action={owner ? 'Add a year' : undefined} onAction={onNewYear} />
        )}
      </Section>

      {locks.length ? (
        <Section title="Lock history">
          <Card padded={false}>
            {locks.map((l, i) => (
              <View key={l.id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: c.line, gap: 2 }}>
                <T v="bodyStrong">Through {fmtDate(l.throughDate)}</T>
                <T v="caption" tone="mute">{l.note || 'No note'}</T>
              </View>
            ))}
          </Card>
        </Section>
      ) : null}
    </DesktopSettingsPage>
  )
}
