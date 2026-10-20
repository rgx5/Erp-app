# Building a module

A module is a slice of the ERP (credit & collections, HR, appointments…). It plugs into the app and the server **without editing
shared files**, so many can be built side by side. `src/modules/purchasing/` (purchase orders) is the worked example — read it
first; copy its shape.

## The shape

```
src/modules/<dir>/
  types.ts          entity types + the CollMap augmentation (declare module '@/data/state' { interface CollMap { … } })
  replication.ts    PURE. registerCollections, registerCollectionMeta, registerPermission, addEffects.   ← the server loads this
  logic.ts …        PURE rules: totals, statuses, ageing, GL postings. No React, no Expo, no I/O.        ← the server may load this
  ops.ts            PURE operations: (state, input, ctx) → { changes, …result }. Throw OpError for refusals.
  index.tsx         UI registration: registerModule (features, reports, notices), registerPanel, hooks…
  ui/               shared components of this module
  __tests__/        jest tests (node)
src/app/m/<dir>/…   the module's screens (expo-router). Every module's routes live under /m/<dir>/ so none can collide.
```

`src/modules/all.ts` and `src/modules/replication-all.ts` already import `./<dir>` and `./<dir>/replication` for every planned
module — **do not edit them**. (If you need a directory that is not listed, tell the person integrating.)

## Data

* **Collections.** A collection is a map of documents `{ id, … }`. Name it in camelCase and make it unique (registering a name
  twice throws). Declare its type in `types.ts` by augmenting `CollMap`, then in `replication.ts`:

  ```ts
  registerCollections(['purchaseOrders'])                       // the app's state + persistence
  registerCollectionMeta({ name: 'purchaseOrders', kind: 'master', perm: 'purchases', branched: true, validate })
  ```
* **kind** — `master`: editable, synced field by field, last writer wins (quotations, employees, tasks). `ledger`: a posted
  document, created once and never edited (a stock movement, a payment, a voucher, a payslip) — mistakes are fixed by a *new*
  document that reverses it. Anything with a number that other things add up should be a ledger collection.
* **Derived numbers** (on-hand stock, a customer's dues) are kept by the server through **effects**: a pure function from a
  posted document to changes on other documents, run in the same transaction. Define them once; the phone applies the same
  function locally (`withEffects(state, changes, ['collection'])` from `@/replication`). Mark the fields they maintain as
  `owned` so a client can never overwrite them. See `purchasing/replication.ts` (`addEffects('purchases', …)`).
  Prefer **computing from documents on the phone** (a pure function over `state`) to adding a derived field — ageing, ledgers and
  reports should not need the server to calculate anything.
* **Permissions.** `registerPermission('accounting', ['manager'])` — names the permission and which built-in roles get it (the
  owner always does). Use it in `perm` on collections, features, panels. Core ones: `pos inventory purchases stock customers
  expenses reports settings viewProfit deleteBill bigDiscount`.
* **Branches.** Set `branched: true` and stamp `branchId: ctx.branchId` on the documents if the module's data belongs to an outlet.
* **Numbers on paper** (QT-0001): `nextNo('QT-', existingNos, ctx)` from `src/modules/numbering.ts` — phones number from their own
  series, so two devices never issue the same number.
* **IDs**: `id('qt_', ctx.now)` from `@/domain/ids`.

## Operations

An operation is a pure function. It reads `state` (a `DataState`), validates, and returns `{ changes }` where `changes` is
`{ put: { coll: docs[] }, del: { coll: ids[] }, store?: …}`. Screens call it through `perform((s, ctx) => op(s, input, ctx))`,
which commits the changes and shows nothing else — operations throw `OpError('A sentence a shopkeeper understands.')` and the
screen toasts `e.message`. Always add an `audit(ctx, ACTION, detail)` entry to `put.audit` for something a manager might ask about.

Do not write `outbox` entries: the server mode derives writes from `changes` automatically
(`mutationsFromChanges`); the old Krishna-compatible mode does not support modules (`needsKosh`).

## Testing the data layer (required)

Every module ships jest tests for its logic and ops, and **one replication test** that proves the server ends up with exactly
what the phone has:

```ts
import { rig } from '@/replication/testkit'
const r = rig(baseState()); await r.seed()
await r.run((s) => savePurchaseOrder(s, draft, undefined, ctx()))
expect((await r.serverView()).purchaseOrders).toEqual(r.phone.purchaseOrders)
```

`rig` runs each operation on a simulated phone, sends its writes through the real replication rules (permissions, immutability,
effects) and lets you compare what a fresh device would download. Also test the refusals (`actorWith(['pos'])` as a cashier).
Helpers for building state: `src/data/__tests__/helpers.ts` (`baseState`, `ctx`, `billInput`, `line`, `NOW`).

## The app

`registerModule({ id, name, tagline, icon, tone, order, features, reports, notices })` — the eleven apps (sales, inventory,
purchasing, accounting, crm, hr, manufacturing, services, industry, reports, admin) already exist in `src/modules/core.ts`; you
**add features to an existing app** by registering its `id` again (name/icon come from the first registration). A feature is a row
on the app's page: `{ id, label, sub, icon, tone, to: '/m/<dir>/…', perm, industries?, section? }`. Reports go in `reports` (shown in
the Report centre), Home-screen alerts in `notices` (pure `(state, now) → notice | null`; fast, they run on every change).

Other places a module can appear (all in `src/modules/registry.ts`):

| Hook | For |
| --- | --- |
| `registerPanel({ slot: 'customer' \| 'item' \| 'bill' \| 'supplier' \| 'line', component })` | a section on that screen (a customer's dues, an item's batches, a bill's delivery status, a line's serial number) |
| `registerCheckoutPanel` | a section in checkout (buyer GSTIN, delivery address, table). Read/write `useCart().extras[moduleId]` — it is saved as `bill.ext[moduleId]` |
| `registerPaymentMethod` | another way to pay (`'due'`, `'giftcard'`); stored in `bill.payments[].mode` |
| `registerCartAdjuster` | reprice cart lines before tax (price lists, quantity breaks, promotions). Pure; **never add or remove lines** |
| `registerBillHook({ beforeSave, onSave })` | refuse a bill (`throw new OpError`) or add documents to the same transaction as the bill |
| `registerReceiptExtra` | lines on the printed bill: header, a note under an item, a footer |
| `registerPermission` / `addEffects` / `registerCollectionMeta` | see Data |

`gate` fields: `perm`, `industries: ['restaurant']`, `needsKosh: true` (hidden when connected to a Krishna-compatible server).

## Screens

* Follow the existing screens (`src/app/m/purchasing/orders/*`, `src/app/purchases/*`): `Screen`, `Section`, `Card`/`Group`,
  `ListRow`, `Field`/`MoneyField`/`NumberField`/`Select`/`Segmented`/`SwitchRow`, `Sheet`, `Button`, `Badge`, `Chip`, `StatTile`,
  `EmptyState`, `Notice`, charts in `@/ui/charts`. Colours and type only through `useTheme()` / `<T v=…>`; numbers use `inr()`.
* Words come from the industry pack (`useLabels()`) where the app calls things "item" or "customer".
* Gate every screen with `useCan(...)` and show a friendly message instead of a blank page. Empty states say what to do next.
* Dates are typed as `YYYY-MM-DD` (see `toInputDate` / `fromInputDate` in `@/domain/dates`). Money fields are strings until used.
* Icons: import from `@/ui/icons`; a lot are exported already. If you need one that is not, **append** one line at the end of that
  file (`export { default as X } from 'lucide-react-native/icons/<file>'`; check `node_modules/lucide-react-native/dist/esm/icons`).
* Reports must be pure functions in `logic.ts` (tested) that the screen only renders; exports use `@/domain/csv` helpers.
* Never import from another module's `ops.ts`/`index.tsx`. Cross-module needs go through collections, effects, panels and hooks.
  You may import another module's `types.ts` / `logic.ts` when it is listed as a dependency below.

## Working rules (several people build modules at the same time in one working tree)

* **Only edit files you own**: `src/modules/<your dir>/**`, `src/app/m/<your dir>/**`, plus any files your brief names. A shared
  file you believe needs a change: make the smallest edit that works (append, do not reformat) and say so in your report.
* Do not run `git`, `prettier`, `eslint --fix`, or anything that rewrites files you do not own. The integrator commits.
* `npx tsc --noEmit` and `npx jest <your dir>` are yours to run; errors in other modules' files are not yours — ignore them.
* Do not run `expo export`.
* Keep it honest: if a feature needs something that cannot work offline or in a phone (a government API, a payment gateway,
  Bluetooth), build everything up to that edge (the document, the payload, the export, the screen) and say plainly what stops there.

## Ownership map (who builds what; the feature inventory is in FEATURES.md)

| Dir | App | Features |
| --- | --- | --- |
| `sales-docs` | sales | quotations → invoice, sales orders + advance booking + layaway (reservations), delivery challans, recurring invoices / AMC, commissions & targets, cash in/out & shifts |
| `credit` | sales | credit sales (udhaar), collections, customer statements, receivables ageing + reminders, gift cards & vouchers, dynamic UPI QR + payment links |
| `pricing` | sales | price lists & tiers & quantity breaks, promotions, B2B invoicing (GSTIN, place of supply, IGST, bill of supply, composition), e-invoice + e-way bill payloads, weighing-scale barcodes. **Owns** `src/domain/cart.ts`, `tax.ts`, `receipt.ts`, `features/cart.ts` |
| `warehouse` | inventory | locations, transfers, batch & expiry, serial/IMEI + warranty, unit conversions, bundles/kits, write-offs |
| `catalog` | inventory | bulk import/export, item photos/attachments/custom fields, label templates, auto-reorder → draft POs, demand forecast, stock valuation / ageing / dead stock / ABC |
| `purchasing` | purchasing | POs (done), approvals, purchase returns / debit notes, supplier payments + ledger + payables ageing, purchase invoices with ITC, landed cost, supplier price lists / RFQ |
| `accounting` | accounting | chart of accounts, the double-entry ledger built from posting rules (`src/modules/postings.ts`), vouchers, party ledgers, day / cash book, trial balance, P&L, balance sheet, financial year + period locks, Tally export |
| `tax` | accounting | bank & cash accounts, bank book, reconciliation + statement import, GSTR-1 / 3B / ITC data, TDS/TCS, fixed assets & depreciation, budgets, cost centres, multi-currency, loans/EMI/PDC, gateway reconciliation (needs `accounting`) |
| `crm` | crm | segments & groups, leads & pipeline, tasks/reminders/notes, campaigns, complaints & tickets & warranty claims, feedback, memberships/referrals, shareable invoice links |
| `hr` | hr | employee master, attendance, shifts/rosters/holidays, leave, payroll, advances/loans/incentives, targets, expense claims, recruitment |
| `manufacturing` | manufacturing | recipes/BOM + costing, work orders, job work / made-to-order, wastage & yield, quality checks |
| `services` | services | appointments, packages & memberships, job cards, projects & timesheets, field visits |
| `industry-food` | industry | restaurant (tables, KOT/KDS, modifiers, split/merge, tips, delivery), grocery (loose ↔ pack, home delivery) |
| `industry-retail` | industry | pharmacy (Schedule H, Rx, substitutes), electronics (trade-in, EMI, warranty claims), apparel (size grid, alterations, markdown), hardware (contractor credit, BOQ) |
| `admin-core` | admin | custom roles & permissions, audit viewer, multi-store + consolidated, approvals, notifications, plans/devices, data export/erasure/retention |
| `admin-platform` | admin | languages, branded templates & logo, tablet layouts, import wizard, webhooks & API keys, integrations scaffolds, online catalogue |
| `reports-plus` | reports | customer & supplier analytics, tax liability, cash flow, comparison, PDF/Excel export for every report, report builder, scheduled reports, forecasting & anomaly alerts |

## The books: postings

You do not write ledger code. If your module creates a financial document, register what it *means* and the accounting module
does the rest (chart of accounts, books, trial balance, statements, party ledgers, ageing):

```ts
import { registerPostingRule } from '@/modules/postings'
registerPostingRule('collections', (c) => ({
  date: c.date, memo: `Collection ${c.no}`,
  lines: [{ account: c.mode === 'cash' ? 'cash' : 'bank', debit: c.amount }, { account: 'receivables', credit: c.amount, party: { type: 'customer', id: c.customerId } }],
}))
```

Rules are pure `(doc, state) → Posting | Posting[] | null`; debits must equal credits (`isBalanced`; test it). Well-known account keys
are listed in `src/modules/postings.ts`; an expense category is `expenseAccount('Rent')`. The ledger is always computed from the
documents — never store balances.

Also: a module may declare more server-kept fields on a collection another module owns with `addOwnedFields('customers', ['dueBalance'])`.
