# Full ERP feature inventory

Status: ✅ built · 🟡 partly built · ⬜ not built yet. **P1 / P2 / P3** is the proposed build order (see the end).

An item is only "built" when it has a screen, its business rules in `src/domain` / `src/data/ops.ts` with tests, and — for
connected workspaces — a sync path to the server.

## 1. Sales & point of sale

| | Feature | Phase |
| --- | --- | --- |
| ✅ | Fast POS: scan / search, variants, quick picks, live cart | |
| ✅ | Item and bill discounts, coupons, price override with permission, per-category "no discount" | |
| ✅ | Loyalty points, store credit, split payments (cash / UPI / card) | |
| ✅ | Parked (held) bills | |
| ✅ | GST invoices, 58 / 80 mm receipts, print, PDF, WhatsApp | |
| ✅ | Returns (partial / full), credit notes, refund as cash or store credit | |
| ✅ | Fractional quantities and units (kg, g, l, m, box, strip, plate, hour…) | |
| ✅ | Sell an item with no price yet (manager approval, audited) | |
| ✅ | Salesperson attribution per line | |
| ⬜ | Quotations / estimates, convert to invoice | P1 |
| ⬜ | Sales orders, advance booking and layaway with part payments | P1 |
| ⬜ | Credit sales (udhaar): due dates, collect part payments, reminders | P1 |
| ⬜ | B2B invoicing: customer GSTIN, place of supply, IGST, bill of supply, composition scheme | P1 |
| ⬜ | Price lists and customer tiers (retail / wholesale / dealer), quantity breaks | P1 |
| ⬜ | Cash in / out and shift management (pay-ins, pay-outs, per-shift report) | P1 |
| ⬜ | Delivery challans and dispatch tracking | P2 |
| ⬜ | Promotions engine (buy-X-get-Y, bundle price, category sale, happy hour) | P2 |
| ⬜ | Gift cards and vouchers, store-credit top-up | P2 |
| ⬜ | Dynamic UPI QR at checkout, payment links | P2 |
| ⬜ | Weighing-scale and price-embedded barcodes | P2 |
| ⬜ | Bluetooth thermal printing, cash-drawer kick | P2 |
| ⬜ | Sales commissions and targets | P2 |
| ⬜ | E-invoice (IRN + QR) and e-way bill | P3 |
| ⬜ | Recurring invoices, subscriptions, AMC billing | P3 |

## 2. Inventory & warehouse

| | Feature | Phase |
| --- | --- | --- |
| ✅ | Items with variants, barcodes, categories with selling rules, HSN and GST per item | |
| ✅ | Stock ledger, adjustments with reasons, scan-based physical count, restock suggestions | |
| ✅ | Barcode label printing, bulk price setting, archive / delete, price-later queue | |
| ✅ | Weighted-average and latest-cost costing | |
| ⬜ | Multiple locations (godowns, shelves) and stock by location | P1 |
| ⬜ | Stock transfers between locations and stores (in transit → received) | P1 |
| ⬜ | Batch / lot tracking, expiry dates, first-expiry-first-out, expiry alerts | P1 |
| ⬜ | Unit conversions (box ↔ piece, carton ↔ strip) and multi-unit pricing | P1 |
| ⬜ | Bulk import / export of items (CSV / Excel) with validation | P1 |
| ⬜ | Stock valuation, ageing, dead stock, ABC analysis | P1 |
| ⬜ | Serial / IMEI tracking and warranty look-up | P2 |
| ⬜ | Bundles, kits and combo items | P2 |
| ⬜ | Item photos and attachments, custom fields | P2 |
| ⬜ | Auto-reorder into draft purchase orders | P2 |
| ⬜ | Reservation of stock against sales orders | P2 |
| ⬜ | Write-off documents: damage, expiry disposal, sample | P2 |
| ⬜ | Label templates designer and QR labels | P2 |
| ⬜ | Demand forecast and min-max suggestions | P3 |

## 3. Purchasing & procurement

| | Feature | Phase |
| --- | --- | --- |
| ✅ | Suppliers, goods receipt (GRN), supplier-bill total check, cost updating, supplier dues, price-later | |
| ⬜ | Purchase orders (draft → approved → part / fully received) | P1 |
| ⬜ | Purchase returns and debit notes | P1 |
| ⬜ | Supplier payments, ledger / statement, payables ageing | P1 |
| ⬜ | Purchase invoices with GST input credit (ITC) | P1 |
| ⬜ | Landed cost allocation (freight, duty, handling) | P2 |
| ⬜ | Supplier price lists, RFQ and quote comparison | P3 |
| ⬜ | Approval workflow for purchase orders | P3 |

## 4. Accounting & finance

| | Feature | Phase |
| --- | --- | --- |
| ✅ | Expenses with categories and recurring flag | |
| ✅ | Cash-drawer day open / close with Z-report | |
| ✅ | GST and HSN summaries | |
| ⬜ | Chart of accounts and double-entry ledger, auto-posted from sales, purchases, expenses, payments | P1 |
| ⬜ | Vouchers: receipt, payment, journal, contra | P1 |
| ⬜ | Customer and supplier ledgers, receivables and payables ageing | P1 |
| ⬜ | Day book, cash book, bank book, trial balance, profit & loss, balance sheet | P1 |
| ⬜ | Bank and cash accounts, bank reconciliation, statement import | P2 |
| ⬜ | GST returns data: GSTR-1, GSTR-3B, ITC (Excel / JSON) | P2 |
| ⬜ | Financial-year management, closing, period locks | P2 |
| ⬜ | Export to Tally and other accounting software | P2 |
| ⬜ | TDS / TCS tracking | P3 |
| ⬜ | Fixed assets and depreciation | P3 |
| ⬜ | Budgets and variance | P3 |
| ⬜ | Cost centres / profit centres | P3 |
| ⬜ | Multi-currency and exchange rates | P3 |
| ⬜ | Loans, EMI, post-dated cheques | P3 |
| ⬜ | Payment-gateway settlement reconciliation | P3 |

## 5. CRM & customer engagement

| | Feature | Phase |
| --- | --- | --- |
| ✅ | Customers: contacts, birthdays and anniversaries, loyalty, store credit, history, call / WhatsApp | |
| ✅ | Coupons | |
| ⬜ | Customer groups and segments (lapsed, high-value, birthday this month) | P1 |
| ⬜ | Leads and sales pipeline with stages and follow-ups | P2 |
| ⬜ | Tasks, reminders, notes and communication log | P2 |
| ⬜ | Campaigns: WhatsApp / SMS broadcast with templates (festival, birthday, dues) | P2 |
| ⬜ | Complaints and after-sales tickets, warranty claims | P2 |
| ⬜ | Feedback and ratings after a sale | P3 |
| ⬜ | Membership tiers and referral programme | P3 |
| ⬜ | Shareable invoice links / customer portal | P3 |

## 6. HR & payroll

| | Feature | Phase |
| --- | --- | --- |
| 🟡 | Staff with roles, PIN login, salesperson numbers | |
| ⬜ | Employee master: profile, documents, bank, emergency contact | P2 |
| ⬜ | Attendance: punch in / out (selfie, location), manual entry, regularisation | P2 |
| ⬜ | Shifts, rosters, holiday calendar | P2 |
| ⬜ | Leave types, balances and approvals | P2 |
| ⬜ | Payroll: salary structure, earnings and deductions, PF / ESI / PT / TDS, payslip PDF, payout register | P2 |
| ⬜ | Salary advances, loans, incentives and commission payout | P2 |
| ⬜ | Targets and performance scorecards | P3 |
| ⬜ | Expense claims and reimbursements | P3 |
| ⬜ | Recruitment and onboarding checklist | P3 |

## 7. Manufacturing & production

| | Feature | Phase |
| --- | --- | --- |
| ⬜ | Recipe costing and ingredient-level stock deduction (restaurant, bakery) | P2 |
| ⬜ | Bill of materials (multi-level) | P3 |
| ⬜ | Work orders: raw-material issue, finished-goods receipt | P3 |
| ⬜ | Job work and made-to-order (tailoring: measurements, stages, delivery date) | P3 |
| ⬜ | Wastage, yield and production costing | P3 |
| ⬜ | Quality checks | P3 |

## 8. Services, projects & field work

| | Feature | Phase |
| --- | --- | --- |
| ⬜ | Appointments and bookings: calendar, staff availability, reminders | P2 |
| ⬜ | Packages and memberships (prepaid sessions) | P2 |
| ⬜ | Job cards / repair tickets with status and parts used | P2 |
| ⬜ | Projects, tasks, timesheets and project billing | P3 |
| ⬜ | Field visits, geo check-in, route tracking | P3 |

## 9. Industry-specific depth

| | Feature | Phase |
| --- | --- | --- |
| ⬜ | Restaurant: tables and floor plan, KOT and kitchen display, modifiers and add-ons, split / merge bills, tips, delivery and aggregator orders | P2 |
| ⬜ | Pharmacy: batch / expiry (see 2), Schedule H / H1 register, doctor and prescription details, substitutes | P2 |
| ⬜ | Electronics: IMEI / serial, warranty and AMC, exchange / trade-in, EMI financing | P2 |
| ⬜ | Salon: appointments and packages (see 8), stylist commission | P2 |
| ⬜ | Apparel: size × colour grid entry, alteration orders, markdown schedules | P2 |
| ⬜ | Grocery: weighing-scale barcodes, loose ↔ pack conversion, home delivery | P2 |
| ⬜ | Hardware: contractor credit accounts, quotations / BOQ, delivery challans | P2 |

## 10. Multi-store & administration

| | Feature | Phase |
| --- | --- | --- |
| ✅ | Owner / manager / cashier roles, PIN login, biometric app lock | |
| ✅ | Backup and restore, sync with the Krishna server, industry switch, appearance, receipt options | |
| 🟡 | Audit log (recorded on every change, no viewer yet) | |
| ⬜ | Custom roles and per-module permissions | P1 |
| ⬜ | Audit-log viewer, filters and activity feed | P1 |
| ⬜ | Multi-store / branch switch with consolidated dashboard and reports | P2 |
| ⬜ | Approval workflows (discount, return, purchase order, expense) | P2 |
| ⬜ | Multi-language (Hindi, Marathi, Gujarati, Tamil…) | P2 |
| ⬜ | Push notifications: low stock, dues, day close, sync problems | P2 |
| ⬜ | Branded invoice templates, logo, attachments | P2 |
| ⬜ | Data-import wizard (Excel, Tally, Vyapar, Busy) | P2 |
| ⬜ | Tablet / landscape two-pane layouts | P2 |
| ⬜ | Delta sync and conflict handling for large multi-device fleets | P2 |
| ⬜ | Webhooks and API keys; integrations (Razorpay / UPI, WhatsApp Business API, Shopify / WooCommerce) | P3 |
| ⬜ | Online catalogue and orders | P3 |
| ⬜ | Plans, licensing and device management (SaaS) | P3 |
| ⬜ | Customer data export / erasure and retention rules | P3 |

## 11. Reports & analytics

| | Feature | Phase |
| --- | --- | --- |
| ✅ | Dashboard (today / 7 / 30 days, profit), sales, GST, profit, items and staff reports, CSV export, day-close report | |
| ⬜ | Receivable and payable ageing, party statements | P1 |
| ⬜ | Inventory valuation, ageing and ABC reports | P1 |
| ⬜ | PDF and Excel export for every report | P1 |
| ⬜ | Customer analytics (lifetime value, retention) and supplier analytics | P2 |
| ⬜ | Tax liability and ITC reports | P2 |
| ⬜ | Cash-flow and comparison reports (period vs period, branch vs branch) | P2 |
| ⬜ | Custom report builder and saved filters | P3 |
| ⬜ | Scheduled reports by email / WhatsApp | P3 |
| ⬜ | Forecasting and anomaly alerts | P3 |

---

## Build order

* **P1 — complete the retail and finance core.** Everything a shop owner and their accountant need to run and close the books:
  credit sales and receivables, quotations and orders, B2B / IGST invoicing, price lists, shifts; locations, transfers, batch and
  expiry, unit conversions, bulk import; purchase orders, returns and supplier payments; the double-entry ledger with vouchers
  and the standard statements; custom roles, audit viewer, ageing and valuation reports, PDF / Excel export.
* **P2 — operations and people.** HR and payroll, attendance, appointments, job cards, campaigns and tasks, multi-store,
  approvals, notifications, languages, tablet layouts, the industry-specific depth, GST returns, bank reconciliation, printing.
* **P3 — advanced.** Manufacturing / BOM, projects, e-invoice, integrations, forecasting, custom reports, SaaS plumbing.

## How each feature gets built

1. Business rules in `src/domain` (pure TypeScript) with tests.
2. A new collection in `DataState`, a pure operation in `src/data/ops.ts`, and a `SyncEntity` for it.
3. Screens in the OneSync design language, gated by a permission, using the industry's own vocabulary.
4. For connected workspaces: the server endpoint and migration, then a live test against a real server (see
   [LIVE-TESTING.md](./LIVE-TESTING.md)).
