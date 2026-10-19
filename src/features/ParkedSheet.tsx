import React from 'react'
import { View } from 'react-native'
import type { Bill } from '@/domain/types'
import { fmtDateTime } from '@/domain/dates'
import { inr0 } from '@/domain/money'
import { useLabels } from '@/data/hooks'
import { deleteHeldBill } from '@/data/ops'
import { perform } from '@/data/store'
import { Button } from '@/ui/Button'
import { Sheet } from '@/ui/Sheet'
import { Card, Row } from '@/ui/primitives'
import { EmptyState } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { Pause } from '@/ui/icons'
import { ask, toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** Bills put on hold to serve the next customer. Resume one to carry on, or discard it. */
export function ParkedSheet({ visible, bills, onClose, onResume }: { visible: boolean; bills: Bill[]; onClose: () => void; onResume: (b: Bill) => void }) {
  const { c } = useTheme()
  const labels = useLabels()
  return (
    <Sheet visible={visible} onClose={onClose} title="Parked bills" subtitle="Put on hold to serve someone else">
      <View style={{ gap: 10, paddingBottom: 10 }}>
        {!bills.length ? <EmptyState compact icon={<Pause size={24} color={c.primary} />} title="Nothing on hold" hint={`Use Hold to park a ${labels.customer.toLowerCase()}'s cart and serve the next person.`} /> : null}
        {bills.map((b) => (
          <Card key={b.id} flat>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <T v="bodyStrong">{b.no}</T>
                <T v="caption" tone="mute">{fmtDateTime(b.date)} · {b.items.length} {b.items.length === 1 ? 'item' : 'items'}</T>
              </View>
              <T v="numLg">{inr0(b.total)}</T>
            </Row>
            <Row style={{ marginTop: 12 }} gap={10}>
              <View style={{ flex: 1 }}><Button label="Resume" size="sm" block onPress={() => { onResume(b); onClose() }} /></View>
              <Button label="Discard" kind="danger" size="sm" onPress={async () => { if (await ask({ title: 'Discard this parked bill?', danger: true, confirm: 'Discard' })) { perform((s, ctx) => ({ changes: deleteHeldBill(s, b.id, ctx) })); toast('Parked bill discarded') } }} />
            </Row>
          </Card>
        ))}
      </View>
    </Sheet>
  )
}
