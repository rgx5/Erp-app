/**
 * The catalog module's documents. An "item" is a core product; everything here hangs off a product or a variant by id, so the
 * core item tables stay exactly as they were.
 */

export type AttachmentKind = 'photo' | 'file'

/** A photo or document of an item. `uri` is a file on the phone that took it; `remoteUrl` appears once it has been uploaded to the server. */
export interface ItemAttachment {
  id: string
  productId: string
  kind: AttachmentKind
  name: string
  uri: string
  mime: string
  size: number
  /** The photo shown first on the item. */
  primary?: boolean
  /** The server's id for the uploaded file (POST /files). */
  remoteId?: string
  remoteUrl?: string
  uploadedAt?: number
  addedAt: number
  addedBy: string
}

export type CustomFieldType = 'text' | 'number' | 'date' | 'choice' | 'yesno'

/** A field the business wants on every item (warranty months, shelf, country of origin…). One definition per business. */
export interface CustomFieldDef {
  id: string
  label: string
  type: CustomFieldType
  /** The choices of a `choice` field. */
  options: string[]
  required: boolean
  active: boolean
  order: number
  createdAt: number
}

export type CustomValue = string | number | boolean

/** The values of one item's custom fields. The id is the product's id. */
export interface CustomFieldValues {
  id: string
  productId: string
  values: Record<string, CustomValue>
  updatedAt: number
}

export type LabelField = 'store' | 'name' | 'variant' | 'brand' | 'sku' | 'barcodeText' | 'hsn' | 'price' | 'mrp'

/** How a price label looks: its size, what it shows, and whether it carries bars or a QR code. */
export interface LabelTemplate {
  id: string
  name: string
  widthMm: number
  heightMm: number
  /** Labels per row on an A4 sheet; 1 for a roll printer. */
  perRow: number
  /** 'sheet' prints on A4; 'roll' makes one page per label (thermal printers). */
  paper: 'sheet' | 'roll'
  fields: LabelField[]
  code: 'bars' | 'qr' | 'none'
  /** What a QR code holds. {barcode} {sku} {name} {price} are filled in per label. */
  qrText: string
  createdAt: number
}

/** Per-variant ordering rules. The id is the variant's id. */
export interface ReorderRule {
  id: string
  variantId: string
  /** Who to order it from (otherwise the supplier of the last receipt). */
  supplierId?: string
  /** Reorder when stock falls to this (otherwise the variant's own reorder level). */
  min?: number
  /** Order up to this much. */
  max?: number
  /** Order in multiples of this (a carton of 12). */
  moq?: number
}

/** The business's catalog settings (one document, id 'catalog'). */
export interface CatalogSettings {
  id: string
  /** Days from placing an order to goods arriving. */
  leadDays: number
  /** Extra days of stock kept against delays. */
  safetyDays: number
  /** Days of sales an order should cover beyond the lead time. */
  coverDays: number
  /** Days of selling history the forecast averages over. */
  windowDays: number
  /** Stock unsold for this many days is dead stock. */
  deadDays: number
  defaultSupplierId?: string
  labelTemplateId?: string
}

export const CATALOG_SETTINGS_ID = 'catalog'
export const DEFAULT_CATALOG_SETTINGS: CatalogSettings = { id: CATALOG_SETTINGS_ID, leadDays: 7, safetyDays: 3, coverDays: 14, windowDays: 56, deadDays: 90 }

declare module '@/data/state' {
  interface CollMap {
    itemAttachments: ItemAttachment
    customFields: CustomFieldDef
    customFieldValues: CustomFieldValues
    labelTemplates: LabelTemplate
    reorderRules: ReorderRule
    catalogSettings: CatalogSettings
  }
}
