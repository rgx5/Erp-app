# Plan: make the OneSyncERP app work with the new backend

Status: proposal for review (nothing here is built yet). Scope: the Expo app in this repo (`src/`) and the NestJS backend in `backend/`. The legacy `server/` folder (Kosh) is out of scope and is not touched or relied on.

## 1. Where we are (verified)

The app cannot connect to the backend today. Run against a live backend, every app call returns 404: no `/health`, `/auth/login`, `/auth/web-login`, `/sync/pull`, `/sync/snapshot`; no CORS headers either (so the web build cannot call it).

The two sides were designed differently:

| | App today | Backend |
|---|---|---|
| Model | one *store*, local-first; domain maths done on the phone | Tenant → Company → GST registration → Location → Warehouse; server-authoritative |
| Wire | whole-store snapshot + outbox of per-entity writes (`bill`, `product`, `stock adjust`, ...) | typed REST under `/v1`, problem+json errors, idempotency keys, UUIDv7 ids |
| Auth | email/password for owners, **PIN** for counter staff, device ids | tenant slug + email + password -> JWT + refresh, MFA, API keys. **No PIN login** |
| Numbers | JS floats, epoch-millisecond dates, ids like `bill_...` | exact decimal strings, ISO dates, UUIDs |
| Tax and totals | computed on the phone, stored as sent | computed by the server GST engine; invoice numbers per registration x financial year |
| Catalogue | product + variants (size/colour), barcode, category, brand, MRP, reorder level | item (code, unit, HSN, tax code, tracking), price lists. **No barcode, variants, categories, brand, MRP or reorder level** |
| Customers | loyalty points, store credit, birthday, coupons | party (credit limit, price list). **No loyalty, store credit, coupons** |
| Money out | expenses | journals only. **No expense voucher** |
| Offline | the whole app works offline | only POS sales/returns have an offline protocol (`/v1/pos/sync/*`, Slice 8d) |

## 2. Principles

1. **The backend is the system of record.** Tax, numbering, stock and ledgers are decided on the server. The app never invents an accounting fact.
2. **Offline only where it matters:** the counter. Catalogue, prices, stock level, customers and tax rates are cached on the device; sales and returns queue and upload through `/v1/pos/sync/batches`. Everything else is online-first.
3. **No silent architecture or business-rule changes.** Where the app expects something the backend lacks, it becomes a named backend slice that you approve (section 5), not a workaround.
4. **A new, fourth workspace kind `onesync`** next to the existing `local` (stand-alone, offline) one. Krishna and Kosh modes are left alone now and removed in a later clean-up once you confirm.
5. **Money crosses the boundary exactly:** the app converts to and from integer paise/decimal strings in one place (the mapper), never with floats.

## 3. Architecture of the integration (app side)

New folder `src/data/onesync/`:

- `api.ts` - typed REST client generated from `backend/docs/openapi.json` (so a backend change breaks the build, not production). Handles bearer token, silent refresh, `Idempotency-Key`, problem+json -> `CloudError`.
- `auth.ts` - sign-in by server address + business code (tenant slug) + email/password (PIN for counter staff once built); tokens in secure store; permission set -> the app's existing role gates.
- `mappers/` - one file per entity pair (item<->product/variant, party<->customer/supplier, sale<->bill, ...), with golden tests in both directions.
- `hydrate.ts` + `delta.ts` - first download and incremental refresh of the offline cache (catalogue, tax rates, stock, customers, store settings).
- `outbox.ts` - sales/returns -> `/v1/pos/sync/batches`; other writes go straight to the API and fail visibly when offline.
- `session.ts` - provisional receipt numbers, shift handling, sync status for the existing `SyncPill`.

Existing pieces reused: the workspace/store machinery (`store.ts`, `state.ts`), the outbox/sync-status UI, the module registry, receipts, scanning, printing. Screens are changed only where a backend concept differs (settings, setup, reports).

## 4. Phases

Each phase ends with something you can use, with automated tests, and is committed and pushed on its own.

### Phase 0 - Contract and test harness (small)
- Decide the open questions in section 6.
- Generate the typed client from `openapi.json`; add a CI check that regenerates it and fails on drift.
- Live test harness in the app repo (like the old `kosh-live` test): boots the backend against a scratch Postgres and runs app code against it. Every later phase adds tests here.
- Parity vectors: the app already has `scripts/gen-golden.ts`; extend it so the phone's tax/discount/rounding maths and the backend GST engine are proven to give identical totals on a few hundred generated carts. **This is the main correctness risk for offline selling.**

### Phase B1 - Backend changes needed to connect (small-medium)
- Configurable CORS allow-list (needed for the web build; harmless for native).
- A public `GET /v1/meta` (name, version, auth modes) so the connect screen can recognise a OneSyncERP server.
- Provisioning path for the first business from the app: either the existing `SELF_SIGNUP_ENABLED` signup (creates tenant + owner) plus a guided "first company" wizard calling the existing organization endpoints, or platform-operator only. See D5.

### Phase F1 - Connect, sign in, first sync (medium)
- Connect screen detects a OneSyncERP server; sign in with business code + email + password; tokens refresh silently; sign-out; "server unreachable" states.
- Role/permission mapping: backend permissions drive which tabs and actions the app shows.
- Setup wizard when the business is empty: company, GST registration, location, warehouse, POS terminal, numbering, chart of accounts template (all existing endpoints).
- Result: you can sign in on a phone and see the real business name, settings and permissions.

### Phase B2 - Backend catalogue gaps (medium; needs your decision D2)
- Item barcodes (several per item), item categories/groups, brand, MRP, reorder level, fractional step, "no discount" flag.
- Variants: either items linked to a parent style with option axes (size, colour), or keep one item per sellable variant with a grouping key.
- Catalogue sync response extended so one call returns what a till needs (items, barcodes, prices from the price list, tax rates, stock by warehouse).

### Phase F2 - Catalogue, stock and customers on the device (medium)
- Hydrate and delta-refresh items, prices, tax slabs, stock and customers into the local collections; works offline after the first sync.
- Items screens read and write through the API (create/edit online); stock adjustments and counts map to the stock endpoints; stock-in-hand reflects server balances.
- Customers/suppliers <-> parties; duplicate detection by phone/GSTIN.

### Phase F3 - Selling at the counter (large - the heart of the app)
- Open/close shift (cash-drawer, variance, Z-report) via `/v1/pos/shifts`.
- Sale -> `/v1/pos/sync/batches` with a device registered via `/v1/pos/devices`; each queued item has a client id so retries never double-book; per-item result shown (applied / rejected with reason and a retry/edit path).
- Receipt shown from the phone's calculation immediately; after sync the server's invoice number and totals replace the provisional ones (see D4 for the numbering rule). Parity tests from Phase 0 guard totals.
- Returns, split payments, parked bills, price-later items.
- Result: a full sell-offline / sync-later day on a phone.

### Phase B3 - Backend: promotions, loyalty and expenses (medium-large; needs D3)
- Coupons, loyalty points, store credit/gift cards as a backend module with ledgers (consistent with the immutable-ledger rules).
- Expense vouchers (category -> expense account, paid from cash/bank), posted through the existing posting service.
- Counter-staff PIN login bound to a device (short-lived token, lockout, audit).

### Phase F4 - Expenses, loyalty, coupons, staff PIN (medium)
- Wire the matching app screens and the counter PIN flow; day-close includes expenses.

### Phase F5 - Purchasing and payables (medium)
- Goods received -> purchase receipts (and orders where used), supplier bills, payments, supplier dues, three-way-match overrides with the approval flow.

### Phase F6 - Reports and dashboard (medium)
- Home screen from `/v1/dashboard`; sales/GST/profit/items/staff reports from server reports (new thin report endpoints where today only client-side analytics exist); GST returns, ageing, statements, bank reconciliation screens; CSV/PDF export stays.

### Phase F7 - Business modules on the backend (large, incremental)
- Accounting (ledger, journals, period close), approvals inbox, bank reconciliation, manufacturing (BOM, work orders), payroll - the app modules switch from local-only data to the backend APIs one at a time. CRM stays local-only until a backend module exists.

### Phase F8 - Migration, release, hardening (medium)
- "Move to server" flow adapted: upload an existing local or Krishna business into a new tenant (masters, opening stock via opening-balance journals and stock opening, customer balances), with a dry-run report.
- End-to-end tests (web build against a live backend), device matrix, performance on a 20k-item catalogue, release checklist, user docs.

## 5. Gap list (what the backend must still gain)

| Gap | Why the app needs it | Phase |
|---|---|---|
| CORS, `GET /v1/meta` | connect from web build, server detection | B1 |
| Item barcodes, categories, brand, MRP, reorder level, variants | scan-and-sell, catalogue, restock suggestions | B2 |
| Till-ready catalogue payload with prices and stock | offline selling | B2 |
| Coupons, loyalty, store credit/gift cards | Customer and checkout features | B3 |
| Expense vouchers | Money tab, day close | B3 |
| Counter-staff PIN login per device | staff sign-in at the till | B3 |
| Report endpoints for sales by item / staff / category | Reports tab | F6 |
| CRM (leads, campaigns, tickets) | CRM module | later |

## 6. Decisions I need from you

| # | Decision | Recommendation |
|---|---|---|
| D1 | First release scope | Retail counter: sign in, catalogue, selling, returns, stock, customers, day close (Phases 0-F3). Purchasing, reports and modules follow. |
| D2 | Variants model | Items with a parent "style" and option axes (size, colour), each variant a sellable stock-keeping item; barcodes on the variant. |
| D3 | Loyalty, coupons, expenses, PIN | Build them in the backend (B3) rather than dropping the features; until then they are hidden in `onesync` workspaces. |
| D4 | Invoice numbers when a till sells offline | The receipt shows a provisional device number; the legal GST invoice number is allocated by the server at sync and the app updates the receipt. (Alternative: lease each till a block of numbers - simpler for customers, but risks gaps and out-of-order dates, which GST dislikes.) |
| D5 | How a business is created | Platform operator creates the tenant; the app's first-run wizard then sets up company/GST/location. Self-signup stays off unless you want public sign-up. |
| D6 | Old modes | Keep `local` (stand-alone). Remove Krishna and Kosh modes after the new mode reaches Phase F3. |

## 7. How we will know it works

- Contract: typed client regenerated in CI; fails on any backend change that breaks the app.
- Live tests: app code against a real backend and Postgres for every phase (sign-in, hydrate, sell offline and sync, return, shift close, rejection and retry, token expiry, tenant isolation).
- Parity: generated-cart vectors prove phone totals equal server totals (rounding, discounts, tax-inclusive prices, split GST).
- End to end: the web build driven by Playwright against a live backend for the main flows.
- Every phase keeps `npm run typecheck`, `npm test` and the backend suites green, and is pushed separately.

## 8. Main risks

1. **Totals mismatch** between phone preview and server (rounding, discounts). Mitigation: parity vectors before any selling work; server result wins and the receipt is updated.
2. **Feature loss** where the backend has no equivalent (loyalty, coupons, CRM). Mitigation: explicit backend slices (B3) or hidden in `onesync` workspaces, decided in D3.
3. **Numbering** rules for offline sales (D4) are a legal/accounting choice, not a technical one.
4. **Catalogue scale** (variants multiply rows). Mitigation: delta sync and paged hydration, tested at 20k items.
5. **Two sources of truth** if local-only and onesync data are mixed. Mitigation: a workspace is exactly one kind; moving between kinds is the migration flow only.
