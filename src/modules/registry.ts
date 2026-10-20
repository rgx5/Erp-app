import type { ComponentType } from 'react'
import type { Bill, Customer, Product, Purchase, StockMove, Supplier, Variant } from '@/domain/types'
import type { CartLine } from '@/domain/cart'
import type { Permission } from '@/domain/permissions'
import type { Changes, DataState } from '@/data/state'
import type { OpCtx } from '@/data/ops'
import type { IconProps } from '@/ui/icons'
import type { Tone } from '@/ui/theme'

/**
 * How a module plugs into the app without editing any shared file.
 *
 *   • a module has a home on the **Apps** screen and lists its features there (`menu`),
 *   • adds numbers to the **Home** screen (`notices`) and entries to the **Reports** hub (`reports`),
 *   • adds sections to the customer / item / bill / supplier screens (`panels`) and to the line editor,
 *   • joins the **sell** flow through hooks: adjust prices, add checkout sections, add payment methods,
 *     validate a bill before it is saved, and write extra documents when it is (`bill`),
 *   • and adds lines to the printed receipt (`receipt`).
 *
 * Collections and their server rules are declared separately, in the module's pure `replication.ts`, because the server
 * loads those without any of the app's UI code.
 */

// ───────────────────────────── where a module lives ─────────────────────────────

export type Icon = ComponentType<IconProps>

export interface FeatureEntry {
  id: string
  label: string
  sub: string
  icon: Icon
  tone: Tone
  /** An expo-router path. */
  to: string
  /** Hidden from people whose role lacks it. */
  perm?: Permission
  /** Only for these industry packs (ids from src/industries). */
  industries?: string[]
  /** Section on the module's page. */
  section?: string
  /** A small count shown on the row (e.g. open orders). */
  badge?: (state: DataState) => number | null
}

export interface ReportEntry {
  id: string
  label: string
  sub: string
  icon: Icon
  tone: Tone
  to: string
  /** "Sales", "Stock", "Accounts", "People"… the group on the Reports hub. */
  group: string
  perm?: Permission
  industries?: string[]
}

export interface HomeNotice {
  id: string
  tone: Tone
  title: string
  body?: string
  action?: string
  /** Where tapping it goes. */
  to?: string
}

export interface ModuleDef {
  id: string
  name: string
  tagline: string
  icon: Icon
  tone: Tone
  /** Position on the Apps screen (lower first). */
  order: number
  /** Needs a Kosh server or an offline workspace; hidden when connected to a Krishna-compatible server (which has no such tables). */
  needsKosh?: boolean
  /** Whole module only for these industries. */
  industries?: string[]
  /** Hidden from people without it. */
  perm?: Permission
  features: FeatureEntry[]
  reports?: ReportEntry[]
  /** Pure: looks at the data and returns something worth a look (overdue dues, expiring stock…), or null. */
  notices?: Array<(state: DataState, now: number) => HomeNotice | null>
}

const modules = new Map<string, ModuleDef>()
const byId = <T extends { id: string }>(list: T[] | undefined, more: T[] | undefined): T[] => {
  const out = [...(list ?? [])]
  for (const x of more ?? []) { const i = out.findIndex((y) => y.id === x.id); if (i >= 0) out[i] = x; else out.push(x) }
  return out
}
/**
 * Adds to an app on the Apps screen. Several pieces of code may register the same `id` (the sales app is built by more
 * than one team of code): the name, icon and position come from the first registration; later ones only add features,
 * reports and notices.
 */
export function registerModule(def: ModuleDef) {
  const cur = modules.get(def.id)
  if (!cur) { modules.set(def.id, def); return }
  modules.set(def.id, { ...cur, features: byId(cur.features, def.features), reports: byId(cur.reports, def.reports), notices: [...(cur.notices ?? []), ...(def.notices ?? [])] })
}
export const allModules = () => [...modules.values()].sort((a, b) => a.order - b.order)
export const moduleById = (id: string) => modules.get(id)

// ───────────────────────────── sections on existing screens ─────────────────────────────

export interface PanelProps {
  customer: { customer: Customer }
  item: { product: Product; variants: Variant[] }
  bill: { bill: Bill }
  supplier: { supplier: Supplier }
  /** Inside the line editor of the sell screen. */
  line: { line: CartLine; patch: (p: Partial<CartLine>) => void }
  /**
   * In the goods-receipt screen, under the items: capture what arrived beyond quantity and cost (batch + expiry, serial numbers,
   * the location it goes to). `ext` is what the screen will save as `purchase.ext`; change it with `setExt(moduleId, value)`.
   */
  receipt: {
    items: Array<{ variantId: string; qty: number; cost: number }>
    ext: Record<string, unknown>
    setExt: (moduleId: string, value: unknown) => void
    /** Change a line's quantity (a unit-conversion helper types "3 box" and sets 36). */
    setQty: (variantId: string, qty: number) => void
  }
}
export type PanelSlotName = keyof PanelProps

export interface PanelDef<S extends PanelSlotName = PanelSlotName> {
  id: string
  slot: S
  /** Lower first. */
  order: number
  perm?: Permission
  industries?: string[]
  needsKosh?: boolean
  component: ComponentType<PanelProps[S]>
}
const panels: PanelDef[] = []
export function registerPanel<S extends PanelSlotName>(p: PanelDef<S>) {
  const i = panels.findIndex((x) => x.id === p.id && x.slot === p.slot)
  if (i >= 0) panels[i] = p as unknown as PanelDef
  else panels.push(p as unknown as PanelDef)
}
export const panelsFor = <S extends PanelSlotName>(slot: S) => panels.filter((p) => p.slot === slot).sort((a, b) => a.order - b.order) as unknown as Array<PanelDef<S>>

// ───────────────────────────── the sell flow ─────────────────────────────

export interface CartCtx {
  state: DataState
  customerId: string | null
  /** Module data the cart carries into the bill (`bill.ext[moduleId]`), set by checkout panels. */
  extras: Record<string, unknown>
}

/** A checkout section (a GSTIN box, a delivery option, a table number…). It reads and writes `extras[id]`. */
export interface CheckoutPanelDef {
  id: string
  order: number
  perm?: Permission
  industries?: string[]
  /** Rendered in the checkout screen, under Discount. */
  component: ComponentType<{ moduleId: string }>
}

export interface PaymentMethodDef {
  /** Stored in `bill.payments[].mode`. */
  id: string
  label: string
  icon: Icon
  order: number
  /** Whether the method is offered for this bill. */
  enabled?: (state: DataState, cart: CartCtx) => boolean
}

export interface BillHookCtx {
  state: DataState
  ctx: OpCtx
  bill: Bill
}
export interface BillHook {
  id: string
  /** Refuse the bill before anything is written: throw an `OpError`. */
  beforeSave?: (c: BillHookCtx) => void
  /** Extra documents / changes that go in the same transaction as the bill. */
  onSave?: (c: BillHookCtx) => Changes | null
}

/** Reprices lines before tax (price lists, quantity breaks, promotions). Pure; applied in order. */
export interface CartAdjuster {
  id: string
  order: number
  adjust: (lines: CartLine[], c: CartCtx) => CartLine[]
}

export interface ReceiptExtra {
  id: string
  /** Lines under the header (a GSTIN, a table number). Plain text; escaped by the renderer. */
  header?: (bill: Bill, state: DataState) => string[]
  /** A short note under an item line (a batch, a serial number). */
  item?: (item: Bill['items'][number], bill: Bill, state: DataState) => string | null
  /** Lines above the footer (dues, a gift-card balance). */
  footer?: (bill: Bill, state: DataState) => string[]
}

/** Runs when goods are received (`receivePurchase`): refuse the receipt, or add documents to the same transaction. */
export interface ReceiptHookCtx {
  state: DataState
  ctx: OpCtx
  purchase: Purchase
  /** The stock movements the receipt creates (one per line) — a hook may re-put them with more detail (a location). */
  moves: StockMove[]
}
export interface ReceiptHook {
  id: string
  beforeSave?: (c: ReceiptHookCtx) => void
  onSave?: (c: ReceiptHookCtx) => Changes | null
}

/** Runs when a return is processed (`processReturn`): add documents to the same transaction (restore a batch). */
export interface ReturnHookCtx {
  state: DataState
  ctx: OpCtx
  original: Bill
  creditNote: Bill
}
export interface ReturnHook {
  id: string
  onReturn?: (c: ReturnHookCtx) => Changes | null
}

const checkoutPanels: CheckoutPanelDef[] = []
const paymentMethods: PaymentMethodDef[] = []
const billHooks: BillHook[] = []
const receiptHooks: ReceiptHook[] = []
const returnHooks: ReturnHook[] = []
const adjusters: CartAdjuster[] = []
const receiptExtras: ReceiptExtra[] = []

const upsert = <T extends { id: string }>(list: T[], x: T) => { const i = list.findIndex((y) => y.id === x.id); if (i >= 0) list[i] = x; else list.push(x) }
export const registerCheckoutPanel = (p: CheckoutPanelDef) => upsert(checkoutPanels, p)
export const registerPaymentMethod = (p: PaymentMethodDef) => upsert(paymentMethods, p)
export const registerBillHook = (h: BillHook) => upsert(billHooks, h)
export const registerReceiptHook = (h: ReceiptHook) => upsert(receiptHooks, h)
export const registerReturnHook = (h: ReturnHook) => upsert(returnHooks, h)
export const registerCartAdjuster = (a: CartAdjuster) => upsert(adjusters, a)
export const registerReceiptExtra = (r: ReceiptExtra) => upsert(receiptExtras, r)

export const checkoutPanelList = () => [...checkoutPanels].sort((a, b) => a.order - b.order)
export const paymentMethodList = () => [...paymentMethods].sort((a, b) => a.order - b.order)
export const billHookList = () => [...billHooks]
export const receiptHookList = () => [...receiptHooks]
export const returnHookList = () => [...returnHooks]
export const receiptExtraList = () => [...receiptExtras]

/** Runs every adjuster over the cart's lines. */
export function adjustLines(lines: CartLine[], c: CartCtx): CartLine[] {
  let out = lines
  for (const a of [...adjusters].sort((x, y) => x.order - y.order)) out = a.adjust(out, c)
  return out
}

/** What every registered module wants printed on this bill. Pass the result as `extras` in the receipt context. */
export function receiptAddOns(bill: Bill, state: DataState): { header: string[]; footer: string[]; item: (it: Bill['items'][number]) => string | null } {
  const list = receiptExtraList()
  return {
    header: list.flatMap((r) => r.header?.(bill, state) ?? []),
    footer: list.flatMap((r) => r.footer?.(bill, state) ?? []),
    item: (it) => list.map((r) => r.item?.(it, bill, state)).filter(Boolean).join(' · ') || null,
  }
}
