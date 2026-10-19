import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { needsPricing, isOverdue } from '@/domain/pricing'
import { useLabels, useVariantViews } from '@/data/hooks'
import { useCan } from '@/data/store'
import { PriceEditor, usePriceDrafts } from '@/features/PriceEntry'
import { Button } from '@/ui/Button'
import { Screen } from '@/ui/Screen'
import { Chip } from '@/ui/primitives'
import { EmptyState, Notice } from '@/ui/blocks'
import { T } from '@/ui/Text'
import { PackageCheck } from '@/ui/icons'
import { toast } from '@/ui/overlays'
import { useTheme } from '@/ui/theme'

/** The "price later" queue: everything received without a selling price. It can't be sold until it has one. */
export default function Pricing() {
  const { c } = useTheme()
  const router = useRouter()
  const labels = useLabels()
  const canEdit = useCan('inventory')
  const views = useVariantViews()
  const [only, setOnly] = useState<'all' | 'overdue'>('all')

  const waiting = useMemo(() => views.filter((v) => v.active && needsPricing(v)).sort((a, b) => (a.unpricedSince ?? Infinity) - (b.unpricedSince ?? Infinity) || a.productName.localeCompare(b.productName)), [views])
  const overdue = useMemo(() => waiting.filter((v) => isOverdue(v)), [waiting])
  const shown = only === 'overdue' ? overdue : waiting
  const form = usePriceDrafts(shown)

  const save = () => { const n = form.save(); if (n) toast(`${n} ${n === 1 ? labels.item.toLowerCase() : labels.items.toLowerCase()} priced`, 'ok') }

  return (
    <Screen title="Price later" subtitle={waiting.length ? `${waiting.length} waiting for a price` : 'Nothing waiting'} back
      footer={canEdit && shown.length ? <Button label={form.filled ? `Save ${form.filled} ${form.filled === 1 ? 'price' : 'prices'}` : 'Save prices'} size="lg" block disabled={!form.filled} onPress={save} /> : undefined}>
      <View style={{ gap: 14, paddingBottom: 12 }}>
        {!canEdit ? <Notice tone="warning" title="Ask a manager" body="Only a manager or the owner can set selling prices." /> : null}
        {waiting.length ? (
          <>
            <T tone="soft">These {labels.items.toLowerCase()} are in stock but have no selling price, so they can’t be billed. Enter a price (and MRP if it differs) — blank rows stay in this list.</T>
            {overdue.length ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Chip label="All" count={waiting.length} selected={only === 'all'} onPress={() => setOnly('all')} />
                <Chip label="Waiting too long" count={overdue.length} tone="warning" selected={only === 'overdue'} onPress={() => setOnly('overdue')} />
              </View>
            ) : null}
            {canEdit ? <PriceEditor variants={shown} form={form} /> : null}
          </>
        ) : (
          <EmptyState icon={<PackageCheck size={26} color={c.primary} />} title="Everything has a price" hint={`Every ${labels.item.toLowerCase()} in stock can be billed.`} action={`View ${labels.items.toLowerCase()}`} onAction={() => router.replace('/(tabs)/items')} />
        )}
      </View>
    </Screen>
  )
}
