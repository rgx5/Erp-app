// Pure half of the pricing module: collections and permissions. The Kosh server loads this file too. See docs/MODULES.md.
import { registerCollections } from '@/data/state'
import { registerPermission } from '@/domain/permissions'
import { DEFAULT_SCALE, scaleLayoutProblem, type ScaleLayout } from '@/domain/scale'
import { registerCollectionMeta } from '@/replication/registry'
import { breakRuleProblem } from './prices'
import { promotionProblem } from './promotions'
import { eInvoiceId, ewayId, priceListItemId, type EInvoiceRecord, type EwayRecord, type PriceList, type PriceListItem, type Promotion, type QtyBreakRule } from './types'
import './types'

// Price lists, promotions and the e-document records are the manager's; every till reads them (a cashier is priced by them).
registerPermission('pricing', ['manager'])

registerCollections(['priceLists', 'priceListItems', 'qtyBreakRules', 'promotions', 'pricingSettings', 'eInvoices', 'ewayBills'])

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v)

registerCollectionMeta(
  {
    name: 'priceLists', kind: 'master', perm: 'pricing', readPerm: 'any',
    validate: (d) => {
      const l = d as unknown as PriceList
      if (typeof l.name !== 'string' || !l.name.trim()) return 'A price list needs a name'
      if (!oneOf(l.tier, ['retail', 'wholesale', 'dealer'])) return 'A price list is retail, wholesale or dealer'
      if (!oneOf(l.basis, ['price', 'mrp', 'cost'])) return 'A price list works on the price, the MRP or the cost'
      if (!finite(l.pct) || l.pct < -100 || l.pct > 1000) return 'The list percentage is not sensible'
      if (!finite(l.roundTo) || l.roundTo < 0) return 'Rounding cannot be negative'
      return null
    },
  },
  {
    name: 'priceListItems', kind: 'master', perm: 'pricing', readPerm: 'any',
    validate: (d) => {
      const p = d as unknown as PriceListItem
      if (typeof p.listId !== 'string' || typeof p.variantId !== 'string') return 'A list price needs a list and an item'
      if (p.id !== priceListItemId(p.listId, p.variantId)) return 'The list price has the wrong id'
      return finite(p.price) && p.price >= 0 ? null : 'A price cannot be negative'
    },
  },
  {
    name: 'qtyBreakRules', kind: 'master', perm: 'pricing', readPerm: 'any',
    validate: (d) => {
      const r = d as unknown as QtyBreakRule
      if (!Array.isArray(r.breaks) || !oneOf(r.target, ['variant', 'product', 'category', 'all'])) return 'A quantity-break rule needs a target and its steps'
      return breakRuleProblem(r)
    },
  },
  {
    name: 'promotions', kind: 'master', perm: 'pricing', readPerm: 'any',
    validate: (d) => {
      const p = d as unknown as Promotion
      if (!oneOf(p.kind, ['buy_x_get_y', 'bundle', 'category_sale', 'happy_hour']) || typeof p.name !== 'string') return 'A promotion needs a kind and a name'
      return promotionProblem(p)
    },
  },
  {
    name: 'pricingSettings', kind: 'master', perm: 'pricing', readPerm: 'any',
    validate: (d) => {
      if (d.id !== 'settings') return 'There is one pricing settings document'
      const scale = d.scale as Partial<ScaleLayout> | undefined
      if (scale) return scaleLayoutProblem({ ...DEFAULT_SCALE, ...scale })
      return null
    },
  },
  {
    name: 'eInvoices', kind: 'master', perm: 'pricing', readPerm: 'any',
    validate: (d) => {
      const r = d as unknown as EInvoiceRecord
      if (typeof r.billId !== 'string' || r.id !== eInvoiceId(r.billId)) return 'An e-invoice record belongs to one bill'
      if (!oneOf(r.status, ['prepared', 'registered', 'cancelled'])) return 'Unknown e-invoice status'
      if (r.status === 'registered' && !/^[0-9a-f]{64}$/i.test(r.irn ?? '')) return 'A registered e-invoice needs its 64-character IRN'
      return null
    },
  },
  {
    name: 'ewayBills', kind: 'master', perm: 'pricing', readPerm: 'any',
    validate: (d) => {
      const r = d as unknown as EwayRecord
      if (typeof r.billId !== 'string' || r.id !== ewayId(r.billId)) return 'An e-way bill record belongs to one bill'
      if (!oneOf(r.status, ['prepared', 'generated', 'cancelled'])) return 'Unknown e-way bill status'
      if (r.status === 'generated' && !/^\d{12}$/.test(r.ewbNo ?? '')) return 'A generated e-way bill needs its 12-digit number'
      return r.transport && typeof r.transport === 'object' ? null : 'An e-way bill record needs its transport details'
    },
  },
)
