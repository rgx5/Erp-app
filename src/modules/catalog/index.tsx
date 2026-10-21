/**
 * Catalog — where it appears in the app. Adds to the Inventory app: bulk import / export of items (CSV and Excel), photos, files and custom
 * fields on items, label designs and QR labels, auto-reorder into draft purchase orders, demand forecast with min–max suggestions, and the
 * stock valuation / ageing / dead-stock / ABC reports.
 *   replication.ts  collections and permissions (pure; the server loads it too)
 *   import.ts / sheet.ts / fields.ts / labels.ts / logic.ts / reports.ts / upload.ts  rules and builders (pure; tested)
 *   ops.ts          operations
 *   src/app/m/catalog/…  its screens
 */
import { Boxes, ChartColumn, ChartLine, ClipboardList, FileSpreadsheet, Hourglass, Image, Layers, Printer, QrCode, Sliders, Tags, Target, TrendingUp } from '@/ui/icons'
import { registerModule, registerPanel } from '../registry'
import { lowCount } from './logic'
import { ItemCatalogPanel } from './ui/ItemPanel'
import './replication'

registerModule({
  id: 'inventory', name: 'Inventory', tagline: 'Items, stock, locations and batches', icon: Boxes, tone: 'accent', order: 20,
  features: [
    { id: 'cat-bulk', label: 'Import & export items', sub: 'CSV or Excel, checked row by row before anything changes', icon: FileSpreadsheet, tone: 'primary', to: '/m/catalog/bulk', perm: 'inventory', section: 'Catalogue tools' },
    { id: 'cat-files', label: 'Photos & files', sub: 'Everything attached to items; send it to the server', icon: Image, tone: 'accent', to: '/m/catalog/files', perm: 'inventory', section: 'Catalogue tools' },
    { id: 'cat-fields', label: 'Custom fields', sub: 'Warranty, shelf, origin — whatever your items need', icon: Sliders, tone: 'default', to: '/m/catalog/fields', perm: 'inventory', section: 'Catalogue tools' },
    { id: 'cat-labels', label: 'Print labels', sub: 'Price tags with bars or a QR code', icon: Printer, tone: 'primary', to: '/m/catalog/labels', perm: 'inventory', section: 'Labels' },
    { id: 'cat-templates', label: 'Label designs', sub: 'Sizes, what shows, QR labels', icon: QrCode, tone: 'accent', to: '/m/catalog/templates', perm: 'inventory', section: 'Labels' },
    { id: 'cat-reorder', label: 'Auto-reorder', sub: 'What to order, by supplier, as draft purchase orders', icon: ClipboardList, tone: 'warning', to: '/m/catalog/reorder', perm: 'purchases', section: 'Planning',
      badge: (s) => lowCount(s) || null },
    { id: 'cat-forecast', label: 'Demand forecast', sub: 'What will sell, and the reorder levels it suggests', icon: TrendingUp, tone: 'success', to: '/m/catalog/forecast', perm: 'reports', section: 'Planning' },
  ],
  reports: [
    { id: 'cat-valuation', label: 'Stock valuation', sub: 'Stock at cost and at selling price', icon: Layers, tone: 'primary', to: '/m/catalog/reports/valuation', group: 'Stock', perm: 'stock' },
    { id: 'cat-ageing', label: 'Stock ageing', sub: 'How long today’s stock has been here', icon: Hourglass, tone: 'warning', to: '/m/catalog/reports/ageing', group: 'Stock', perm: 'stock' },
    { id: 'cat-dead', label: 'Dead stock', sub: 'Stock that has stopped selling', icon: Tags, tone: 'danger', to: '/m/catalog/reports/dead', group: 'Stock', perm: 'stock' },
    { id: 'cat-abc', label: 'ABC analysis', sub: 'The few items that make most of the sales', icon: ChartColumn, tone: 'accent', to: '/m/catalog/reports/abc', group: 'Stock', perm: 'reports' },
    { id: 'cat-r-forecast', label: 'Demand forecast', sub: 'Expected sales and days of stock left', icon: ChartLine, tone: 'success', to: '/m/catalog/forecast', group: 'Stock', perm: 'reports' },
    { id: 'cat-r-reorder', label: 'Reorder list', sub: 'What to order now, by supplier', icon: Target, tone: 'warning', to: '/m/catalog/reorder', group: 'Stock', perm: 'purchases' },
  ],
  notices: [
    (s) => {
      const n = lowCount(s)
      return n ? { id: 'cat-reorder', tone: 'warning', title: `${n} ${n === 1 ? 'item is' : 'items are'} at or below the reorder level`, body: 'Make draft purchase orders from the suggestions', action: 'Reorder', to: '/m/catalog/reorder' } : null
    },
  ],
})

registerPanel({ id: 'catalog.item', slot: 'item', order: 40, perm: 'inventory', component: ItemCatalogPanel })
