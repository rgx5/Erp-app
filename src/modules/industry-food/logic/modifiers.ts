import { listOf, type DataState } from '@/data/state'
import type { FoodModifierGroup, FoodModifierPick } from '../types'

/** Modifier groups that apply to an item's category (a group with no categories applies to everything). */
export const groupsForCategory = (state: DataState, categoryId: string | undefined): FoodModifierGroup[] =>
  listOf(state.foodModifierGroups).filter((g) => g.active && (!g.categoryIds.length || (categoryId && g.categoryIds.includes(categoryId))))

/** Why a group's picks cannot be used as they are ("Choose at least 1 spice level"), or null. */
export function groupProblem(group: Pick<FoodModifierGroup, 'name' | 'min' | 'max'>, pickedCount: number): string | null {
  if (group.min > 0 && pickedCount < group.min) return `Choose at least ${group.min} for ${group.name}`
  if (group.max > 0 && pickedCount > group.max) return `Choose at most ${group.max} for ${group.name}`
  return null
}

export function pickOf(group: Pick<FoodModifierGroup, 'id' | 'name'>, option: { id: string; name: string; priceDelta: number }): FoodModifierPick {
  return { groupId: group.id, groupName: group.name, optionId: option.id, name: option.name, priceDelta: option.priceDelta }
}
