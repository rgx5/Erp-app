import React from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { fmtDayShort } from '@/domain/dates'
import { inr } from '@/domain/money'
import { useApp, useCan, useUser } from '@/data/store'
import { approvableBy, awaitingApproval, settingsOf } from '@/modules/purchasing/approvals'
import { Screen } from '@/ui/Screen'
import { Badge, Card } from '@/ui/primitives'
import { EmptyState, ListRow, Notice, Section } from '@/ui/blocks'
import { ClipboardCheck } from '@/ui/icons'
import { T } from '@/ui/Text'
import { useTheme } from '@/ui/theme'

/** Purchase orders waiting for a yes, and which of them the signed-in person may decide. */
export default function Approvals() {
  const { c } = useTheme()
  const router = useRouter()
  const can = useCan('purchases')
  const data = useApp((s) => s.data)
  const user = useUser()
  if (!can) return <Screen title="Approvals" back><T tone="mute">Approvals are for the owner and managers.</T></Screen>
  const settings = settingsOf(data)
  const waiting = awaitingApproval(data)
  const mine = new Set(approvableBy(data, user?.role).map((o) => o.id))
  const open = (id: string) => router.push({ pathname: '/m/purchasing/orders/[id]', params: { id } })

  return (
    <Screen title="Approvals" subtitle="Purchase orders waiting for a decision" back>
      <View style={{ gap: 14, paddingBottom: 24 }}>
        {!settings.approvalsOn ? <Notice tone="primary" title="Approvals are off" body="Switch them on in Purchasing settings to ask for a yes on big orders." /> : null}
        {waiting.length ? (
          <Section title={`Waiting · ${waiting.length}`} style={{ marginTop: 0 }}>
            <Card padded={false}>
              {waiting.map((o) => (
                <ListRow key={o.id} title={`${o.no} · ${data.suppliers[o.supplierId]?.name ?? 'Supplier'}`} subtitle={`Made ${fmtDayShort(o.date)}`} value={inr(o.total, 0)}
                  badge={mine.has(o.id) ? <Badge tone="primary">You can decide</Badge> : <Badge tone="warning">Needs a higher role</Badge>} onPress={() => open(o.id)} />
              ))}
            </Card>
          </Section>
        ) : settings.approvalsOn ? <EmptyState icon={<ClipboardCheck size={26} color={c.primary} />} title="Nothing is waiting" hint={`Orders above ${inr(settings.approvalAbove, 0)} appear here until they are approved.`} /> : null}
      </View>
    </Screen>
  )
}
