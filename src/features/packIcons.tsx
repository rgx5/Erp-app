import React from 'react'
import type { PackIcon } from '@/industries/types'
import { Hammer, Pill, Scissors, ShoppingBasket, Shirt, Phone, Store, Utensils, type IconProps } from '@/ui/icons'
import type { ComponentType } from 'react'

const MAP: Record<PackIcon, ComponentType<IconProps>> = {
  shirt: Shirt, 'shopping-basket': ShoppingBasket, pill: Pill, smartphone: Phone, utensils: Utensils, scissors: Scissors, hammer: Hammer, store: Store,
}

export function PackGlyph({ icon, size = 22, color }: { icon: PackIcon; size?: number; color?: string }) {
  const I = MAP[icon] ?? Store
  return <I size={size} color={color} strokeWidth={1.9} />
}
