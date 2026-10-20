import React from 'react'
import { gstinProblem, gstinState, stateName } from '@/domain/gst'
import { useList } from '@/data/hooks'
import { OpError } from '@/data/ops'
import { perform, useCan } from '@/data/store'
import type { Customer } from '@/domain/types'
import { Select } from '@/ui/Inputs'
import { Notice, Section } from '@/ui/blocks'
import { Card } from '@/ui/primitives'
import { T } from '@/ui/Text'
import { toast } from '@/ui/overlays'
import { assignPriceList } from '../ops'
import { TIER_LABEL } from '../types'

/** On a customer's page: the price list they buy on, and a check of the GSTIN saved for them. */
export function CustomerPricing({ customer }: { customer: Customer }) {
  const lists = useList('priceLists').filter((l) => l.active || l.id === customer.priceListId)
  const canEdit = useCan('pricing')
  const problem = gstinProblem(customer.gstin)
  if (!lists.length && !problem && !customer.gstin) return null
  return (
    <Section title="Pricing" style={{ marginTop: 6 }}>
      <Card style={{ gap: 12 }}>
        {lists.length ? (
          canEdit ? (
            <Select<string> label="Price list" value={customer.priceListId ?? ''} placeholder="Normal selling prices"
              options={[{ value: '', label: 'Normal selling prices' }, ...lists.map((l) => ({ value: l.id, label: l.name, sub: TIER_LABEL[l.tier] }))]}
              onChange={(v) => {
                try { perform((s, ctx) => assignPriceList(s, customer.id, v, ctx)); toast('Price list saved', 'ok') } catch (e) { toast(e instanceof OpError ? e.message : 'Could not save', 'err') }
              }} />
          ) : <T v="body">Price list: {lists.find((l) => l.id === customer.priceListId)?.name ?? 'Normal selling prices'}</T>
        ) : null}
        {customer.gstin ? <T v="caption" tone="mute">GSTIN {customer.gstin}{gstinState(customer.gstin) ? ` · ${stateName(gstinState(customer.gstin))}` : ''}</T> : null}
        {problem ? <Notice tone="warning" title="This GSTIN looks wrong" body={problem} /> : null}
      </Card>
    </Section>
  )
}
