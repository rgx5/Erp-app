import React from 'react'
import { panelsFor, type PanelProps, type PanelSlotName } from './registry'
import { useGate } from './hooks'

/** Renders what modules have registered for a slot on an existing screen (a customer's dues, an item's batches…). */
export function PanelSlot<S extends PanelSlotName>({ slot, ...props }: { slot: S } & PanelProps[S]) {
  const gate = useGate()
  const list = panelsFor(slot).filter((p) => gate(p))
  if (!list.length) return null
  return (
    <>
      {list.map((p) => {
        const C = p.component as React.ComponentType<PanelProps[S]>
        return <C key={p.id} {...(props as unknown as PanelProps[S])} />
      })}
    </>
  )
}
