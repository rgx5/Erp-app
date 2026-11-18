import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router'
import { useSession } from '@/auth/session'
import { ConnectPage } from '@/features/auth/ConnectPage'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { CompaniesPage } from '@/features/organization/CompaniesPage'
import { SetupPage } from '@/features/setup/SetupPage'
import { ItemsPage } from '@/features/masterdata/ItemsPage'
import { PartiesPage } from '@/features/masterdata/PartiesPage'
import { PriceListsPage } from '@/features/masterdata/PriceListsPage'
import { PaymentTermsPage, TaxCodesPage, UnitsPage } from '@/features/masterdata/ReferencePages'
import { InvoiceDetailPage } from '@/features/sales/InvoiceDetailPage'
import { InvoiceEditorPage } from '@/features/sales/InvoiceEditorPage'
import { InvoicesPage } from '@/features/sales/InvoicesPage'
import { ReceiptsPage } from '@/features/sales/ReceiptsPage'
import { ReceivablesPage } from '@/features/sales/ReceivablesPage'
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage'
import { BillDetailPage } from '@/features/purchasing/BillDetailPage'
import { BillEditorPage } from '@/features/purchasing/BillEditorPage'
import { BillsPage } from '@/features/purchasing/BillsPage'
import { GoodsReceiptsPage } from '@/features/purchasing/GoodsReceiptsPage'
import { PayablesPage } from '@/features/purchasing/PayablesPage'
import { PaymentsPage } from '@/features/purchasing/PaymentsPage'
import { PurchaseOrderDetailPage } from '@/features/purchasing/PurchaseOrderDetailPage'
import { PurchaseOrderEditorPage } from '@/features/purchasing/PurchaseOrderEditorPage'
import { PurchaseOrdersPage } from '@/features/purchasing/PurchaseOrdersPage'
import { BankPage } from '@/features/accounting/BankPage'
import { ChartPage } from '@/features/accounting/ChartPage'
import { JournalEditorPage, JournalsPage } from '@/features/accounting/JournalsPage'
import { PeriodsPage } from '@/features/accounting/PeriodsPage'
import { ReportsPage } from '@/features/accounting/ReportsPage'
import { GstPage } from '@/features/gst/GstPage'
import { ReportCentrePage } from '@/features/gst/ReportCentrePage'
import { CostingPage } from '@/features/manufacturing/CostingPage'
import { BomsPage, WorkCentresPage } from '@/features/manufacturing/MastersPages'
import { SubcontractingPage } from '@/features/manufacturing/SubcontractingPage'
import { WorkOrderDetailPage, WorkOrdersPage } from '@/features/manufacturing/WorkOrdersPage'
import { EmployeesPage } from '@/features/payroll/EmployeesPage'
import { RemittancesPage } from '@/features/payroll/RemittancesPage'
import { PayrollRunsPage } from '@/features/payroll/RunsPage'
import { PayrollSetupPage } from '@/features/payroll/SetupPage'
import { PosAdminPage } from '@/features/pos/AdminPage'
import { CounterPage } from '@/features/pos/CounterPage'
import { CountsPage } from '@/features/inventory/CountsPage'
import { MovementsPage } from '@/features/inventory/MovementsPage'
import { StockPage } from '@/features/inventory/StockPage'
import { TransfersPage } from '@/features/inventory/TransfersPage'
import { ValuationPage } from '@/features/inventory/ValuationPage'
import { Shell } from '@/ui/Shell'

const root = createRootRoute({ component: Outlet })

const connect = createRoute({ getParentRoute: () => root, path: '/connect', component: ConnectPage })
const login = createRoute({
  getParentRoute: () => root,
  path: '/login',
  beforeLoad: () => {
    const s = useSession.getState()
    if (s.status === 'authenticated') throw redirect({ to: '/' })
    if (!s.server) throw redirect({ to: '/connect' })
  },
  component: LoginPage,
})

/** Everything behind sign-in. */
const app = createRoute({
  getParentRoute: () => root,
  id: 'app',
  beforeLoad: () => {
    const s = useSession.getState()
    if (s.status !== 'authenticated') throw redirect({ to: s.server ? '/login' : '/connect' })
  },
  component: Shell,
})
const dashboard = createRoute({ getParentRoute: () => app, path: '/', component: DashboardPage })
const companies = createRoute({ getParentRoute: () => app, path: '/organization/companies', component: CompaniesPage })

const setup = createRoute({ getParentRoute: () => app, path: '/setup', component: SetupPage })
const items = createRoute({ getParentRoute: () => app, path: '/masterdata/items', component: ItemsPage })
const customers = createRoute({ getParentRoute: () => app, path: '/masterdata/customers', component: () => <PartiesPage role="customer" /> })
const suppliers = createRoute({ getParentRoute: () => app, path: '/masterdata/suppliers', component: () => <PartiesPage role="supplier" /> })
const taxCodes = createRoute({ getParentRoute: () => app, path: '/masterdata/tax-codes', component: TaxCodesPage })
const units = createRoute({ getParentRoute: () => app, path: '/masterdata/units', component: UnitsPage })
const paymentTerms = createRoute({ getParentRoute: () => app, path: '/masterdata/payment-terms', component: PaymentTermsPage })
const priceLists = createRoute({ getParentRoute: () => app, path: '/masterdata/price-lists', component: PriceListsPage })
const invoices = createRoute({ getParentRoute: () => app, path: '/sales/invoices', component: InvoicesPage })
const newInvoice = createRoute({ getParentRoute: () => app, path: '/sales/invoices/new', component: InvoiceEditorPage })
const invoiceDetail = createRoute({ getParentRoute: () => app, path: '/sales/invoices/$invoiceId', component: InvoiceDetailPage })
const receipts = createRoute({ getParentRoute: () => app, path: '/sales/receipts', component: ReceiptsPage, validateSearch: (s: Record<string, unknown>): { customerId?: string } => (typeof s['customerId'] === 'string' ? { customerId: s['customerId'] } : {}) })
const receivables = createRoute({ getParentRoute: () => app, path: '/sales/receivables', component: ReceivablesPage })
const supplierSearch = (s: Record<string, unknown>): { supplierId?: string } => (typeof s['supplierId'] === 'string' ? { supplierId: s['supplierId'] } : {})
const orders = createRoute({ getParentRoute: () => app, path: '/purchasing/orders', component: PurchaseOrdersPage })
const newOrder = createRoute({ getParentRoute: () => app, path: '/purchasing/orders/new', component: PurchaseOrderEditorPage })
const orderDetail = createRoute({ getParentRoute: () => app, path: '/purchasing/orders/$orderId', component: PurchaseOrderDetailPage })
const goodsReceipts = createRoute({ getParentRoute: () => app, path: '/purchasing/receipts', component: GoodsReceiptsPage })
const bills = createRoute({ getParentRoute: () => app, path: '/purchasing/bills', component: BillsPage })
const newBill = createRoute({ getParentRoute: () => app, path: '/purchasing/bills/new', component: BillEditorPage, validateSearch: supplierSearch })
const billDetail = createRoute({ getParentRoute: () => app, path: '/purchasing/bills/$billId', component: BillDetailPage })
const payments = createRoute({ getParentRoute: () => app, path: '/purchasing/payments', component: PaymentsPage, validateSearch: supplierSearch })
const payables = createRoute({ getParentRoute: () => app, path: '/purchasing/payables', component: PayablesPage })
const approvals = createRoute({ getParentRoute: () => app, path: '/approvals', component: ApprovalsPage })
const stock = createRoute({ getParentRoute: () => app, path: '/inventory/stock', component: StockPage })
const movements = createRoute({ getParentRoute: () => app, path: '/inventory/movements', component: MovementsPage })
const transfers = createRoute({ getParentRoute: () => app, path: '/inventory/transfers', component: TransfersPage })
const counts = createRoute({ getParentRoute: () => app, path: '/inventory/counts', component: CountsPage })
const valuationRoute = createRoute({ getParentRoute: () => app, path: '/inventory/valuation', component: ValuationPage })
const chartRoute = createRoute({ getParentRoute: () => app, path: '/accounting/chart', component: ChartPage })
const journalsRoute = createRoute({ getParentRoute: () => app, path: '/accounting/journals', component: JournalsPage })
const newJournalRoute = createRoute({ getParentRoute: () => app, path: '/accounting/journals/new', component: JournalEditorPage })
const periodsRoute = createRoute({ getParentRoute: () => app, path: '/accounting/periods', component: PeriodsPage })
const reportsRoute = createRoute({ getParentRoute: () => app, path: '/accounting/reports', component: ReportsPage })
const bankRoute = createRoute({ getParentRoute: () => app, path: '/accounting/bank', component: BankPage })
const gstRoute = createRoute({ getParentRoute: () => app, path: '/gst', component: GstPage })
const reportCentreRoute = createRoute({ getParentRoute: () => app, path: '/report-centre', component: ReportCentrePage })
const workCentresRoute = createRoute({ getParentRoute: () => app, path: '/manufacturing/work-centres', component: WorkCentresPage })
const bomsRoute = createRoute({ getParentRoute: () => app, path: '/manufacturing/boms', component: BomsPage })
const woRoute = createRoute({ getParentRoute: () => app, path: '/manufacturing/orders', component: WorkOrdersPage })
const woDetailRoute = createRoute({ getParentRoute: () => app, path: '/manufacturing/orders/$orderId', component: WorkOrderDetailPage })
const jobWorkRoute = createRoute({ getParentRoute: () => app, path: '/manufacturing/job-work', component: SubcontractingPage })
const costingRoute = createRoute({ getParentRoute: () => app, path: '/manufacturing/costing', component: CostingPage })
const payrollSetupRoute = createRoute({ getParentRoute: () => app, path: '/payroll/setup', component: PayrollSetupPage })
const peopleRoute = createRoute({ getParentRoute: () => app, path: '/payroll/people', component: EmployeesPage })
const payrollRunsRoute = createRoute({ getParentRoute: () => app, path: '/payroll/runs', component: PayrollRunsPage })
const duesRoute = createRoute({ getParentRoute: () => app, path: '/payroll/dues', component: RemittancesPage })
const counterRoute = createRoute({ getParentRoute: () => app, path: '/pos/counter', component: CounterPage })
const posAdminRoute = createRoute({ getParentRoute: () => app, path: '/pos/admin', component: PosAdminPage })
const tree = root.addChildren([connect, login, app.addChildren([counterRoute, posAdminRoute, payrollSetupRoute, peopleRoute, payrollRunsRoute, duesRoute, workCentresRoute, bomsRoute, woRoute, woDetailRoute, jobWorkRoute, costingRoute, reportCentreRoute, gstRoute, chartRoute, journalsRoute, newJournalRoute, periodsRoute, reportsRoute, bankRoute, stock, movements, transfers, counts, valuationRoute, orders, newOrder, orderDetail, goodsReceipts, bills, newBill, billDetail, payments, payables, approvals, invoices, newInvoice, invoiceDetail, receipts, receivables, dashboard, setup, companies, items, customers, suppliers, taxCodes, units, paymentTerms, priceLists])])

// A hash history works the same on a custom app:// origin and in a browser, with no server-side route fallback to configure.
import { createHashHistory } from '@tanstack/react-router'
export const router = createRouter({ routeTree: tree, history: createHashHistory(), defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
