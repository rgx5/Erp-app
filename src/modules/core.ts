import {
  Boxes, Briefcase, Calculator, ChartColumn, ChefHat, Clock, Contact, Factory, Receipt, ReceiptText, Settings, ShoppingCart, Truck, Users, Wallet, Wrench, Package, Tags, Scan, ScanBarcode, ClipboardList, Landmark, Layers,
} from '@/ui/icons'
import { registerModule } from './registry'

/**
 * The eleven apps on the Apps screen and the features that already existed before modules did. Everything else is added by
 * the module that builds it (see MODULES.md). Order here is the order on screen.
 */
registerModule({
  id: 'sales', name: 'Sales', tagline: 'Billing, orders, credit and pricing', icon: ShoppingCart, tone: 'primary', order: 10,
  features: [
    { id: 'sell', label: 'New bill', sub: 'Scan, search and charge', icon: ReceiptText, tone: 'primary', to: '/(tabs)/sell', perm: 'pos', section: 'Counter' },
    { id: 'bills', label: 'Bills & returns', sub: 'Every bill, return and receipt', icon: Receipt, tone: 'primary', to: '/bills', section: 'Counter' },
    { id: 'dayclose', label: 'Day close', sub: 'Count the drawer and close the day', icon: Clock, tone: 'accent', to: '/dayclose', perm: 'reports', section: 'Counter' },
  ],
})
registerModule({
  id: 'inventory', name: 'Inventory', tagline: 'Items, stock, locations and batches', icon: Boxes, tone: 'accent', order: 20,
  features: [
    { id: 'items', label: 'Items', sub: 'Catalogue, variants, barcodes', icon: Package, tone: 'primary', to: '/(tabs)/items', perm: 'inventory', section: 'Catalogue' },
    { id: 'pricing', label: 'Price later', sub: 'Items waiting for a price', icon: Tags, tone: 'warning', to: '/items/pricing', perm: 'inventory', section: 'Catalogue' },
    { id: 'stock', label: 'Stock', sub: 'On hand, low and out', icon: Boxes, tone: 'accent', to: '/stock', perm: 'stock', section: 'Stock' },
    { id: 'restock', label: 'Restock list', sub: 'What to reorder', icon: ClipboardList, tone: 'warning', to: '/stock/restock', perm: 'stock', section: 'Stock' },
    { id: 'count', label: 'Stock count', sub: 'Scan the shelf', icon: ScanBarcode, tone: 'success', to: '/stock/count', perm: 'stock', section: 'Stock' },
    { id: 'ledger', label: 'Stock ledger', sub: 'Every movement', icon: Layers, tone: 'default', to: '/stock/ledger', perm: 'stock', section: 'Stock' },
  ],
})
registerModule({
  id: 'purchasing', name: 'Purchasing', tagline: 'Orders, receipts, suppliers and payables', icon: Truck, tone: 'primary', order: 30,
  features: [
    { id: 'receive', label: 'Receive stock', sub: 'Goods received from a supplier', icon: Truck, tone: 'primary', to: '/purchases/new', perm: 'purchases', section: 'Buying' },
    { id: 'purchases', label: 'Purchases & suppliers', sub: 'Receipts and what you owe', icon: Briefcase, tone: 'primary', to: '/purchases', perm: 'purchases', section: 'Buying' },
  ],
})
registerModule({
  id: 'accounting', name: 'Accounts', tagline: 'Expenses, ledgers, statements and tax', icon: Calculator, tone: 'success', order: 40,
  features: [
    { id: 'expenses', label: 'Expenses', sub: 'Rent, salaries and running costs', icon: Wallet, tone: 'warning', to: '/expenses', perm: 'expenses', section: 'Money out' },
  ],
})
registerModule({
  id: 'crm', name: 'Customers', tagline: 'People, loyalty, follow-ups and campaigns', icon: Contact, tone: 'success', order: 50,
  features: [
    { id: 'customers', label: 'Customers', sub: 'Contacts, points and credit', icon: Users, tone: 'success', to: '/customers', perm: 'customers', section: 'People' },
  ],
})
registerModule({ id: 'hr', name: 'People & payroll', tagline: 'Staff, attendance, leave and salaries', icon: Briefcase, tone: 'primary', order: 60, needsKosh: true, features: [] })
registerModule({ id: 'manufacturing', name: 'Production', tagline: 'Recipes, work orders and job work', icon: Factory, tone: 'accent', order: 70, needsKosh: true, features: [] })
registerModule({ id: 'services', name: 'Services & projects', tagline: 'Appointments, job cards and projects', icon: Wrench, tone: 'success', order: 80, needsKosh: true, features: [] })
registerModule({ id: 'industry', name: 'Industry tools', tagline: 'Built for your kind of business', icon: ChefHat, tone: 'accent', order: 90, needsKosh: true, features: [] })
registerModule({
  id: 'reports', name: 'Reports', tagline: 'Sales, tax, stock, accounts and people', icon: ChartColumn, tone: 'success', order: 100,
  features: [
    { id: 'reports', label: 'Sales, GST & profit', sub: 'The main reports', icon: ChartColumn, tone: 'success', to: '/(tabs)/reports', perm: 'reports', section: 'Reports' },
    { id: 'hub', label: 'All reports', sub: 'Every report from every app', icon: Landmark, tone: 'primary', to: '/report-centre', perm: 'reports', section: 'Reports' },
  ],
})
registerModule({
  id: 'admin', name: 'Admin', tagline: 'Roles, branches, approvals and integrations', icon: Settings, tone: 'default', order: 110,
  features: [],
})

void Scan
