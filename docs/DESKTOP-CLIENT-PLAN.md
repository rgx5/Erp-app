# Plan: OneSyncERP desktop client for the new backend

Status: proposal for review; nothing here is built yet. This replaces the earlier "adapt the Expo app" plan.

## 1. Direction (decided)

| Question | Decision |
|---|---|
| What is the product? | A **desktop-first ERP client** (Windows, macOS, Linux) for the NestJS backend in `backend/`. The existing Expo/phone app was a demo; it is not extended and not a constraint. |
| Build how? | A **new client** in `desktop-client/`: Electron shell + React 19 + TypeScript + Vite. The old `desktop/` shell and the Expo app stay untouched until retired; the legacy `server/` folder is ignored. |
| UI stack | Vite, TanStack Router + Query + Table (+ Virtual), React Hook Form + Zod, Tailwind + shadcn/Radix, lucide icons. |
| Offline | **Online-first.** Only the POS counter will work offline (via the existing `/v1/pos/sync/*` protocol). |
| First release | **Back-office core and billing:** sign-in, organization setup, master data, sales invoicing and receipts, purchasing and payments, accounting, dashboard. Counter POS, manufacturing, payroll and the rest follow. |

The backend decisions stay as they are (tenant -> company -> GST registration -> location -> warehouse, server-computed tax and numbering, immutable ledgers, approvals, idempotency). The client is designed to fit them rather than the reverse.

## 2. Architecture

```
desktop-client/
  electron/        main process: window, app:// protocol, secure token store, printing, file dialogs, auto-update later
  src/
    api/           typed client generated from backend/docs/openapi.json; auth, refresh, idempotency, problem+json mapping
    domain/        pure helpers: exact money (decimal strings, never floats), Indian number/date formats, GST labels
    ui/            design system (tables, forms, dialogs, command palette, keyboard shortcuts)
    features/      one folder per backend domain (sales, purchasing, inventory, accounting, ...)
    routes/        TanStack Router file routes
  tests/           Vitest + Testing Library; Playwright-Electron journeys against a live backend
```

Key rules:

1. **Server-authoritative.** The client never computes tax, totals, numbers or balances that get stored; it shows what the server returned. Where a screen needs a figure before saving (invoice totals while typing) it asks the server (see gap G2) instead of re-implementing the GST engine.
2. **Contract by generation.** `openapi-typescript` + `openapi-fetch` from `backend/docs/openapi.json`; CI regenerates and fails on drift, so a backend change that breaks the client breaks the build, not production.
3. **Exact money.** Amounts are decimal strings end to end; a small helper does arithmetic on integers (ported from the backend's `money.ts`).
4. **Safe mutations.** Every write sends an `Idempotency-Key`; optimistic concurrency uses `If-Match` versions; problem+json errors map to field errors, toasts with the request id, or a conflict dialog ("changed since you opened it").
5. **Permission-driven UI.** `/v1/auth/me` permissions decide which navigation and actions exist; the server still enforces everything.
6. **Stable origin and storage.** The window loads from a custom `app://` origin (fixed), preferences live in a file under the user's data folder, and the refresh token is stored with Electron `safeStorage` (OS keychain) through a minimal preload bridge. Context isolation on, Node integration off.
7. **Keyboard-first, dense, fast.** Virtualised grids (100k rows), saved column layouts and filters, command palette (Ctrl+K), document line grids you can enter without the mouse, Indian formats (lakh grouping, dd/mm/yyyy), print and PDF of invoices via the shell, CSV/XLSX export.

## 3. Screens map (by backend domain)

Dashboard | Organization (companies, GST registrations, locations, warehouses, number series) | Master data (items, units, tax codes, parties, price lists) | Sales (quotes, orders, invoices, credit/debit notes, receipts, receivables, ageing, statements) | Purchasing (orders, receipts/GRN, bills, debit notes, payments, landed cost, payables, three-way-match overrides) | Inventory (stock, ledger, adjustments, transfers, counts, batches/serials, reservations) | Accounting (chart, journals, periods, statements, year-end, bank reconciliation) | GST returns | Manufacturing | Payroll | Approvals inbox | POS counter | Admin (users, roles, API keys, audit log, security).

## 4. Slices

Each slice ends with working, tested software, is committed and pushed, and gets a review summary.

| Slice | Content |
|---|---|
| **D0 Foundation** | Scaffold (electron-vite), `app://` origin, safeStorage, design system, generated API client, error/problem handling, auth shell, permission-driven navigation, test harness (Vitest, Playwright-Electron against a live backend), CI build for Windows/macOS/Linux. Backend B1 in parallel (below). |
| **D1 Sign-in and setup** | Server address + business code + email/password (+ MFA); session lock; first-run wizard (company, GST registration, location, warehouse, number series, chart-of-accounts template); settings. |
| **D2 Master data** | Items (HSN/SAC, tax code, tracking), units, tax codes, parties (customer/supplier, GSTIN validation), price lists; fast search; import/export. |
| **D3 Sales** | Invoice editor with line grid and server-computed totals, tax invoices and bills of supply, quotes/orders, credit/debit notes, receipts and allocation, receivables ageing and statements, A4 GST invoice print/PDF. |
| **D4 Purchasing and payables** | Orders, receipts, supplier bills with match status, payments and allocation, payables ageing, landed cost; approvals inbox and the `Approval-Id` flow. |
| **D5 Inventory** | Stock on hand by warehouse, stock ledger, adjustments, transfers, counts, batches/serials, reservations, valuation and reconciliation. |
| **D6 Accounting and dashboard** | Chart of accounts, manual journals (with approval request flow), periods and locking, Schedule III statements, year-end, bank reconciliation, dashboard. |
| **D7 GST and reports** | GSTR-1, GSTR-3B, ITC register, CMP-08; report centre with export. |
| **D8 Manufacturing** | Work centres, BOMs, work orders, costing and variances, subcontracting. |
| **D9 Payroll** | Employees and contract workers, structures, statutory rules, runs, payslips, remittances. |
| **D10 POS counter** | Shifts, scan-and-sell, returns, offline queue via `/v1/pos/sync`, silent receipt printing, cash drawer; needs backend gaps G4-G6. |
| **D11 Admin and release** | Users, roles, API keys, audit viewer, backups guidance, signed installers, auto-update, user docs. |

## 5. Backend gaps found (small, scheduled just before the slice that needs them)

| # | Gap | Needed for | Plan |
|---|---|---|---|
| G1 | CORS for the `app://` origin; public `GET /v1/meta` (name, version, auth modes) | D0/D1 | Configurable allow-list env var; tiny endpoint. |
| G2 | No document "calculate" endpoint: totals are only known after posting | D3, D4 | `POST /v1/sales/invoices/calculate` (and PO/bill) returning lines, tax split and totals without writing; same engine as posting. |
| G3 | Item lookups the grids need: search by code/name/barcode with stock and price in one call; party search by GSTIN/phone | D2, D3 | Extend list endpoints with search and expand options. |
| G4 | Item barcodes, categories, brand, MRP, variants | D10 (and nicer D2) | Backend slice, design to be agreed before building. |
| G5 | Loyalty, coupons, store credit | D10 | Optional; only if you want them. |
| G6 | Expense vouchers; counter-staff PIN login | D10 | Backend slice before D10. |
| G9 | Company setup status and standard defaults (done in D1) | D1 | `GET /v1/companies/{id}/setup/status`, `POST .../setup/apply-defaults`. |
| G2 | Invoice calculate endpoint (done in D3a) | D3 | `POST /v1/sales/invoices/calculate`. |
| G7 | Bulk import endpoints (items, parties, opening balances) | D2, migration | Validated dry-run + commit pattern. |

## 5b. Progress

| Slice | State |
|---|---|
| D0 Foundation (+ G1 CORS, `/v1/meta`) | done |
| D1 Sign-in and setup (+ G9 setup service, path parameters in OpenAPI) | done: first-run wizard (company, GST registration, place of business, warehouse, financial year, one-click standard setup) and the setup checklist |
| D2 Master data | done: items, customers, suppliers, price lists (with prices), tax codes (with dated rates), units, payment terms; search, filters, paging, CSV export and import with a pre-check report, party addresses; list search widened on the backend |
| D3a Sales core (+ G2 calculate) | done: invoice editor (keyboard grid, live server totals), invoice list and detail, cancel, credit and debit notes, A4 invoice PDF/print, receipts with allocation, receivables ageing, customer position and statement with CSV |
| D3b Quotes and orders | not started |
| D4 Purchasing, payables, approvals (+ G2b bill preview) | done: purchase orders (editor, receive goods, close/cancel), goods receipts with returns, supplier bills (from received goods and service lines, "Check bill" preview with match status and approver override, cancel), supplier payments with allocation, payables ageing, position and statement, approvals inbox with rules, request flow and "Post now". Not yet: debit notes, landed cost, journals editor (D6) |
| D5 Inventory | done: stock on hand by warehouse with item stock card (date range, running balance), adjustments (take out / put in with cost), movements ledger with detail, transfers (direct or via in-transit, receive, cancel), stock counts (freeze, enter counted, post differences), valuation with a check against the inventory accounts, CSV export. No backend change was needed. Not yet: batches and serial numbers, reservations, negative-stock settings |
| D6 Accounting and bank reconciliation | done: chart of accounts (create, edit, CSV), manual journals (balanced-entry editor, approval request flow, reverse with reason), journal list with filters, financial reports (trial balance with account-ledger drill-down, profit and loss, balance sheet, cash flow, CSV), periods (close, reopen, lock), new financial year, year-end close and reopen, bank accounts, CSV statement import (signed amount or withdrawal/deposit columns), auto-match, match, book charges, ignore, unmatch, reconciliation statement. No backend change was needed. Not yet: dashboard polish, Schedule III notes, statement PDF export |
| D7 onwards | not started |

## 6. Testing and delivery

- Unit: pure helpers (money, formats), form schemas, error mapping.
- Component: Testing Library for forms and grids.
- **Live journeys:** Playwright-Electron against the real backend and Postgres (docker-compose already exists), one journey per slice: sign in, set up a company, create an item and a customer, raise an invoice, receive payment, see it in the ledger and dashboard.
- Contract drift check in CI; typecheck and lint gates; installers built for all three OSes in GitHub Actions.
- Performance budget: first paint under 2 s, 100k-row grid scroll at 60 fps, invoice with 200 lines editable without lag.

## 7. Risks

1. **Calculation previews** (G2) must reuse the exact posting engine, otherwise the editor and the posted invoice could disagree; solved by one shared code path and tests that compare them.
2. **Scope size.** The backend has 240 endpoints; mitigated by slices and by generating the client and list/detail scaffolding rather than hand-writing each screen.
3. **Signing and auto-update** (Windows/macOS certificates) need accounts you control; planned in D11, not needed to develop.
4. **Backend gaps** (G4-G6) are business-visible choices (variants, loyalty); they will be agreed with you before building.

## 8. What I propose to do first

D0 together with backend G1: scaffold `desktop-client/`, generate the client, build the shell, the design system and the auth/navigation skeleton, add the live Playwright harness and CI, then D1.
