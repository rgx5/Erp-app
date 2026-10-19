import { apparel } from './apparel'
import { grocery } from './grocery'
import { pharmacy } from './pharmacy'
import { electronics } from './electronics'
import { restaurant } from './restaurant'
import { salon } from './salon'
import { hardware } from './hardware'
import { general } from './general'
import type { IndustryPack } from './types'

export type { IndustryPack, DemoItem, PackCategory } from './types'

/** Every industry the app is ready for. Adding one is a single file that exports an `IndustryPack` — see docs/INDUSTRIES.md. */
export const INDUSTRIES: IndustryPack[] = [apparel, grocery, pharmacy, electronics, restaurant, salon, hardware, general]

export const industryById = (id: string | undefined): IndustryPack => INDUSTRIES.find((p) => p.id === id) ?? general
