# Architecture decisions (Slices 0-5)

Each decision lists what was chosen, why, and what is deliberately deferred. Items marked **ASSUMPTION** are things
I decided without a business rule from you; please confirm or correct them.

## Shape
Modular monolith: one deployable, domain modules under `src/modules/<domain>` with their own schema, service and controller;
cross-module access goes through exported services only. Manufacturing is the first industry specialization, so the later
slices (inventory, costing, procurement, accounting) are designed with BOM/WIP/subcontractor concepts from the start; Slice 0
already has `raw_material`, `work_in_progress`, `finished_goods`, `scrap`, `quarantine`, `in_transit`, `subcontractor` warehouse kinds.
No microservices, Kafka or Kubernetes. Redis is not used.

## ADR-1 Platform: NestJS 12, TypeScript 6, ESM, strict
NestJS 12.4 is ESM-only (`module: nodenext`, `.js` import suffixes). Strict TypeScript with `noUncheckedIndexedAccess`.
Tests: Vitest; lint: oxlint (type-aware). Constructor injection uses explicit `@Inject(Class)` so the code behaves
the same under tsx/esbuild (no decorator metadata) and `nest build`.
**Dependency graph**: installs cleanly with strict peer resolution on **npm 11.21** and no `legacy-peer-deps`.
npm 10.9 crashes on this graph (arborist bug), so the repo pins `packageManager: npm@11.21.2`, `engines.npm >= 11`, and CI/Docker install npm 11.
Nest's first-party add-ons (outbox, idempotency, drizzle, locks, authn/authz) are pre-1.0, so integrity-critical parts are hand-written.

## ADR-2 HTTP adapter: Fastify default, Node adapter switchable
Both adapters pass the identical 55-test HTTP suite (the suite runs on both in CI) and the production build.
Measured on 4 vCPU, 32 connections, 6 s:

| scenario | Fastify | NodeAdapter |
| --- | --- | --- |
| GET /health/live | 16,188 req/s | 19,450 |
| GET /v1/tenant (DB, RLS tx) | 1,917 | 2,211 |
| list companies | 1,191 | 1,169 |
| POST company | 1,824 | 1,963 |

With any DB work the difference is noise (<15%). **Recommendation: Fastify**, for ecosystem maturity (plugins, hooks, schema tooling) and
because the code touching the adapter is a thin, adapter-agnostic layer (`HttpAdapterHost`). `HTTP_ADAPTER=fastify|node` keeps the switch; CI tests both.
This is a recommendation for your review, not a locked decision.

## ADR-3 Database: PostgreSQL, SQL-first migrations, Drizzle as typed query layer
The database is the source of truth: migrations are hand-written SQL (constraints, triggers, RLS, grants are not expressible in an ORM schema).
Drizzle's table definitions mirror them for typed queries; a test fails if the mirror drifts from the real columns.

## ADR-4 Tenancy and row-level security
Hierarchy: Tenant → Company → GST registration → Business location (branch) → Warehouse. A company has many GST registrations.
- Every business row carries `tenant_id`; primary keys are `(tenant_id, id)` and **every foreign key includes `tenant_id`**
  (FK integrity checks bypass RLS, so composite keys are what stop a cross-tenant reference).
- RLS is `ENABLE` + `FORCE` on every table with one policy `tenant_isolation` for role `erp_app`: `tenant_id = erp.current_tenant_id()`.
- The tenant is set per transaction with `set_config('app.tenant_id', $1, true)` (transaction-local), so pooled connections cannot leak a tenant. There is no bypass or platform mode.
- Runtime role `erp_app`: NOSUPERUSER, NOBYPASSRLS, owns nothing, no CREATE, only explicit `SELECT/INSERT/UPDATE` grants (**no DELETE**).
  Schema owner `erp_migrator` is a separate role used only by the migration runner. The app refuses to boot if the role is unsafe.
- A location must belong to a registration of its own company (composite FK `(tenant_id, company_id, gst_registration_id)`).

## ADR-5 Migrations
Forward-only SQL files `db/migrations/NNNN_name.sql`, each in its own transaction, sha256 checksum recorded in `erp.schema_migrations`,
guarded by an advisory lock. The runner rejects an edited, missing or out-of-order applied file and rolls a failing file back.
Readiness (`/health/ready`) fails if the database is behind the build's expected migration head.

## ADR-6 API conventions
Zod 4 validation through Nest's standard-schema pipe; OpenAPI generated from the same schemas.
Errors are RFC 9457 `application/problem+json` with stable `urn:erp:error:<code>` types; Postgres errors map to 409/422/403/503 without leaking SQL text.
Optimistic locking: rows have `version` (trigger-maintained); updates need `If-Match: <version>` (428 missing, 412 stale).
UUIDv7 ids, keyset pagination with opaque cursors. Request ids and security headers on every response; pino logs with secret redaction.

## ADR-7 Identity and authorization (Slice 1a)
- **Sign-in** is `tenant slug + email + password (+ MFA code)`. Passwords: **argon2id** (`@node-rs/argon2`, OWASP minimum profile; hashes carry their parameters and are upgraded on login). Length rule only (12+), no composition rules.
- **Access tokens**: EdDSA (Ed25519) JWTs, 15 min, hand-written on `node:crypto` (only EdDSA accepted, `kid` header, previous public keys can be listed for rotation). The token proves *who*; **permissions, user status, tenant status and session liveness are re-read from the database on every request** (one query), so a role change, disable or logout takes effect on the next request.
- **Refresh tokens**: opaque, 30 days, stored as SHA-256, **rotating**; each token is single-use and presenting a spent one revokes its whole session family (reuse detection). Concurrent double-refresh with one token will log that family out (stricter, no grace window).
- **MFA**: TOTP (RFC 6238, verified against the RFC vector), seed encrypted at rest with AES-256-GCM bound to tenant+user, each 30 s step usable once, 10 single-use hashed recovery codes.
- **Lockout**: N failures (default 5) locks the account for 15 min. Unknown tenant, unknown user, wrong password and locked account return the *same* 401 and do equal password-hash work.
- **API keys**: `ek_<tenant>_<id>_<secret>`, SHA-256 stored, shown once, explicit permission list, optional expiry, revocable (never deleted).
- **Authorization**: roles hold permission strings from a code-defined catalog; the built-in Owner role has `*`. **Default deny**: every route needs `@Public()` or `@RequirePermissions()/@Authenticated()`; a route that declares nothing returns 403. Nobody can grant a role, key or user more than they hold themselves; the last active owner cannot be removed or disabled.
- `tenant_directory` (slug -> id) is the one readable non-tenant mapping needed to start a sign-in; it is filled by a trigger and not writable by the runtime role.
- Not in this slice: SSO, password reset by email, invitations, per-IP rate limiting (belongs at the proxy/edge until Redis is introduced), branch/amount-limit rules (need documents to mean anything).

## ADR-8 Audit log (append-only)
Entries are written **inside the transaction of the change they describe** (no entry for a rolled-back change, none missing for a committed one). The runtime role has INSERT/SELECT only; a trigger also rejects UPDATE/DELETE/TRUNCATE from any role, superuser included. Auth events (login, failure, lockout, refresh-token reuse, password change, MFA), user/role/API-key changes and organization writes are recorded with actor, request id and IP; secrets are never recorded. Read with `GET /v1/audit-events` (newest first, filters, cursor). Tamper-evident hash chain deferred as agreed.

## ADR-9 Idempotency
`Idempotency-Key` on selected POSTs (optional by default, can be made required per route). The claim, the business work and the stored response commit **in one transaction** (the unit of work lets nested calls join the outer transaction), so there is no "in progress" state to get stuck in: concurrent duplicates wait on the unique key then replay; a failing request rolls the claim back and can be retried; a crash leaves nothing behind. Same key + different request or caller is 422. Keys expire (default 24 h) and are per tenant. Endpoints that return secrets (API key creation) deliberately do not use it, because the replay would have to store the secret.

## ADR-10 Transactional outbox
Events are inserted in the business transaction. A relay (in-process, optional, safe to run on several instances) delivers them **at least once** to registered consumers: `FOR UPDATE SKIP LOCKED` + lease, exponential backoff, parked as `dead` after N attempts with the last error (never dropped). Consumers are idempotent by construction: their effects and a `(event, consumer)` done-mark commit in one transaction. The queue table `outbox_dispatch` is **the second deliberate non-tenant table**: it holds only pointers (tenant id, event id, scheduling state), created by a trigger, so the relay can find work across tenants without the runtime role ever bypassing RLS; each event is read and handled inside its own tenant's context. No broker is involved (Postgres only), per the "no Kafka prematurely" direction.

## ADR-11 Document numbering
One series per **GST registration x document type x financial year** (no global counter). Allocation locks only that series row *inside the document's transaction*, so a number is consumed iff the document commits (no gaps from failures), and concurrent allocation is serialised per series only. Every issued number is kept in `number_allocations` forever; cancelling marks it cancelled and it is never reissued; the database allows only the single transition issued -> cancelled. Format = prefix + optional FY code + padded value, validated at creation so the widest possible number is <= 16 chars of `[A-Za-z0-9/-]` (rule 46 CGST). No HTTP endpoint hands out numbers; documents call `NumberingService.allocate` (Slice 5+).

## ADR-12 Ambient transactions
`UnitOfWork.inTenant` nested inside another `inTenant` for the *same tenant* joins it; a different tenant, or a write inside a read-only transaction, throws. This is what lets idempotency, audit, outbox and numbering participate in one atomic unit without threading `tx` through every signature, and it is the base for the later posting operations.

## ADR-13 Master data (Slice 2)
Currencies, exchange rates, units, tax codes with effective-dated rates, items, payment terms, parties (customers / suppliers / subcontractors as roles of one record), party addresses, price lists. Principles:
- **Effective dating is enforced by the database**: `EXCLUDE USING gist` (btree_gist, installed by the admin bootstrap into the `erp` schema) makes overlapping tax-rate or price periods impossible; a guard trigger lets a row be *closed* once and never rewritten or deleted. A rate change is one call: the open version is closed the day before the new one starts. Documents resolve the rate/price/exchange rate **for their own date**, so back-dated documents are right (`CatalogService.taxRateOn`, `PricingService.priceOn`, `CatalogService.rateOn`).
- **Manufacturing from day one**: item types `raw_material, packing_material, semi_finished, finished_good, trading_good, consumable, service`; `is_manufactured` only for semi-finished/finished; batch/serial tracking only for stocked items; per-item unit conversions (box of 12 -> factor 12); subcontractor role on parties.
- **Statutory checks live in both the API and the database**: HSN 4/6/8 digits, SAC 6 digits starting 99, GST UQC list for units, CGST = SGST = IGST/2, GSTIN format + check character, PAN inside GSTIN must match, registered treatments need a GSTIN and unregistered ones must not have one, PIN code only for Indian addresses.
- **Item identity is frozen**: code, type and base unit cannot change after creation (database trigger), because stock, costing and BOMs will depend on them.
- Money, quantities and rates are **decimal strings**, never floats. Exchange rates are immutable facts per date (correct by adding a new date); inverse rates are not derived.
- New tenants are seeded with INR and the 44 statutory units. **Tax rates are not seeded** (they are tenant configuration; a wrong default silently mis-taxes documents).

## ADR-14 Accounting core (Slice 3)
Chart of accounts, fiscal years/periods, the double-entry journal, trial balance and account ledger, per **company** (each company keeps its own books).
- **One posting door**: `PostingService.post(tx, ...)`. The manual-journal API and every future subledger (sales, purchases, stock, payroll, manufacturing) call it *inside their own transaction*, so a document and its ledger entry commit or roll back together, the entry number is returned on rollback, and a document cannot be posted twice (unique `(source type, source id, event)`; a repeat returns the existing entry).
- **Immutable ledger**: `journal_entries`/`journal_lines` have no UPDATE/DELETE/TRUNCATE for any role (triggers fire even for a superuser). Corrections are **reversing entries**: the mirror image, linked to the original, at most once, never reversing a reversal; entries created by a document can only be reversed through that document.
- **The database guarantees the invariants, the application only gives nicer errors**: a deferred constraint trigger checks at COMMIT that lines match the header and debits = credits; lines can only be added by the transaction that created the entry; the entry must fall in an **open** period containing its date; group and inactive accounts cannot be posted to.
- **Period locking**: `open <-> closed` (reopen needs its own permission, newest first; closing is in order) and `closed -> locked` (permanent). Posting takes the period row `FOR SHARE`, closing takes it `FOR UPDATE`: a close waits for postings in flight and later postings see the close, so nothing slips into a closed period (race-tested).
- **Posting controls**: manual journals cannot touch **control accounts** (receivables, payables, inventory, WIP, tax); only subledgers post there. This is how the later inventory subledger will reconcile to the GL without anyone editing the control accounts by hand.
- **Exact money**: amounts are decimal strings summed as integers of 1/10000; no floats anywhere.
- **Manufacturing from the start**: the opt-in starter chart (`POST /v1/companies/:id/chart-of-accounts/template`) has raw-material / packing / WIP / finished-goods / material-with-subcontractor inventory, GRNI, overheads absorbed, subcontracting, scrap, production variances and purchase price variance accounts. It is a convenience, not a policy: apply it, or build your own.
- Entry numbers `JV|OB|AJ|RV|SY/<FY>/<6 digits>` are per company x fiscal year x type (no global counter; not a statutory series).

## ADR-15 Inventory subledger (Slice 4a)
Decisions you made for this slice: **weighted average and FIFO per item**, **negative stock blocked by default with a per-warehouse override**, **batch (with expiry) and serial tracking**.
- **One entry point**: `StockService.move(tx, ...)`. It costs each line, enforces tracking and negative-stock rules, appends immutable ledger rows, updates balances/layers, and posts the matching GL entry via `PostingService`, all in the caller's transaction. Future purchasing, sales, production, transfers and counts call it with their own source (`goods_receipt:<id>` ...), so a document and its stock + GL effect are atomic and never applied twice.
- **Costing**: valuation is per **item per warehouse**. Weighted average derives the unit cost from balance value / quantity at issue time (no stored running average to drift); emptying a balance takes the exact remaining value, so no rounding residue stays. FIFO keeps cost layers (oldest *receipt date* first, not posting order) and records every consumption. All arithmetic is integer (qty and cost 6 dp, value 4 dp, half-up), never floating point. An item's costing method and tracking freeze once it has any movement (trigger).
- **Negative stock**: an issue beyond the balance is refused (409, with the available quantity) unless the **warehouse** allows negative stock **and** the item is weighted average; the shortfall is costed at the last known cost. FIFO items, batch balances and serial numbers can never go negative.
- **Batches/serials**: batch-tracked items need a batch on every line (created on receipt with optional manufacture/expiry dates); expired or blocked batches cannot be received or issued; serial-tracked items need exactly one distinct serial per unit and each unit moves in_stock -> issued.
- **GL link and reconciliation**: item type -> inventory control account is configured per company; opening stock and adjustments post against configured offset accounts; receipts/issues name their offset (HTTP callers cannot use control accounts, documents can). `GET /v1/inventory/reconciliation` compares, per stock account, the stock ledger value with the GL balance as of a date. Any difference is reported, `reconciled` is true only when all are zero. Because manual journals cannot post to control accounts, the two can only differ through a defect, which is exactly what this proves.
- **Locking**: balance rows are locked per (warehouse, item) in a fixed order (no deadlocks); 20 simultaneous issues against 10 units produced exactly 10 successes. Stock dates lock with the books: a movement needs an open accounting period.
- The stock ledger is append-only like the journal. Corrections are opposite movements; reversing a movement automatically (needed by document cancellation) arrives with the purchasing and sales slices that need it.

## ADR-16 Reservations, transfers and counts (Slice 4b)
All three change stock only through `StockService.move`, so ledger, balances and GL stay in agreement (re-asserted by the reconciliation in every test).
- **Reservations** hold quantity without moving it. Availability = on hand - active, unexpired reservations; other issues cannot take reserved stock (409 with `reserved` in the problem), an issue that names the reservation consumes it (partially or fully), and release/expiry give it back. Creating a reservation takes the *same balance-row lock* as a movement, so a reservation and an issue can never both claim the last unit. Batch-specific reservations protect that batch. Serial-tracked items are not reservable yet (issue by serial). Warehouses that allow negative stock can still be issued past reservations (the operator chose to relax stock rules there).
- **Transfers** are direct or two-step through an `in_transit` warehouse (dispatch now, receive later, partial receipts, cancel back to source if nothing was received). Stock moves at its own exact value, FIFO cost layers keep their cost *and receipt date*, batches and serial numbers travel (serials stay in stock and change warehouse). Because a transfer stays inside one inventory account it produces **no GL entry**; the in-transit warehouse keeps the value in the subledger. For weighted-average items the in-transit cost is pooled per item (two overlapping transfers of one item blend until received; total value is conserved).
- **Counts** snapshot the books, record what was found, and post one `count_adjustment` movement. Differences are measured against the stock held *at posting* with balances locked first (movements after the snapshot are not double-counted); gains use the line's cost or the valuation cost, losses the valuation cost; batch items count per batch; serial-tracked items are excluded. Every line must be counted before posting; posted/cancelled counts are frozen by a trigger.
- **Deadlock safety**: every movement first locks all its balance rows in one fixed (warehouse, item) order, then processes outgoing lines before incoming ones; 20 simultaneous opposite-direction transfers all succeeded.

## ADR-17 Sales and GST (Slice 5a: invoices, notes, cancellation)
Decisions you made: **per-line tax rounded to the paisa, invoice rounded to the rupee with a separate round-off line; standard domestic place-of-supply rules plus SEZ/export (with or without payment of tax) and a reverse-charge flag; invoices issue stock directly, credit limit warns only, e-invoice fields reserved**.
- **GST engine** (`gst.ts`) is pure integer arithmetic with no I/O, unit-tested separately. Place of supply: goods = ship-to state, else bill-to, else the supplier's state (counter sale); services = recipient's billing state; exports = 96 (Other Country). Within the supplier's state: CGST+SGST (each half the rate); anywhere else, and always for SEZ and exports: IGST. Each tax component per line is rounded half up to the paisa; the payable total is rounded to the nearest rupee and the difference is a signed round-off posted to a configured account. Tax-inclusive prices (retail MRP) back the tax out of the price. Rates are the item's tax code rate **in force on the invoice date** (Slice 2), recorded per line.
- **Documents**: tax invoice, bill of supply (composition suppliers, tax-free), credit note (returns at the *original* price and *original* tax rate; stock comes back at the *original cost*; serial numbers must be among those invoiced; quantity limited to what is still creditable) and debit note. Numbers come from the per-GST-registration/document-type/financial-year series built in Slice 1.
- **One transaction**: a document number, the stock movement (issue at cost, or return), the journal (receivable with the customer as dimension / revenue / output CGST-SGST-IGST-cess / round-off), the document and its lines, audit and event. A failure (insufficient stock, closed period, missing account) leaves nothing behind, including the number (tested).
- **Immutable documents**: a posted document and its lines cannot be edited or deleted (trigger, any role). The database re-checks the arithmetic at commit: header totals equal the sum of the lines, CGST = SGST, IGST only between states, the grand total reconciles (reverse charge excluded from what is collected). A cancelled invoice keeps its number (cancelled in the allocation ledger, never reused); cancellation reverses the journal and brings stock back at the *exact* value it left at (serials and batches restored), is refused once credit/debit notes exist, and honours period locks. Notes are not cancelled; issue the opposite note.
- **Not built, by design**: delivery challans, e-invoice IRN / e-way bill (columns reserved, nothing reads them), TCS/TDS on sales, composition-scheme *customer* rules beyond treating them as registered, multi-currency sales (base currency only), selling units other than the item's base unit, a draft state for invoices (posting is immediate).

## Assumptions to confirm
1. GST registration types: regular, composition, SEZ, casual, non-resident, input-service-distributor, TDS/TCS deductor (check constraint list, easy to change).
2. GSTIN: 15 chars, format regex, state code = first two digits, PAN inside GSTIN must equal the company PAN. State code validity table is not enforced. A GSTIN is unique per tenant.
3. Business location's `gst_registration_id` is nullable (non-GST site); at most one *principal* location per registration.
4. Financial-year default is April–March (company setting, not yet used by any posting).
5. No DELETE privilege for the app role anywhere (soft-state via `active`/effective dates).
6. Warehouse kinds list above.
7. Numbering: the GST financial year is fixed April-March (statutory) and independent of the company's books year; `document_type` is a free `snake_case` string until the document slices define the registry.
8. Permission catalog (`organization`, `users`, `roles`, `api_keys`, `audit`, `numbering` read/write) is a starting set; the only built-in role is Owner. Other roles are tenant-defined.
9. Session lengths: access 15 min, refresh 30 days, lockout 5 failures / 15 min (all configurable).
10. Self-signup is OFF by default; tenants are provisioned by the platform operator.
12. Master data: parties are one table with roles; GST treatments = registered_regular, registered_composition, sez, deemed_export, unregistered, consumer, overseas; one GSTIN per party; a party's state comes from its addresses (not checked against its GSTIN prefix yet).
13. Items: no item categories/groups, brands, variants, barcodes or per-item costing method yet (costing method is decided with the inventory slice). Services are never stocked. Tax code on an item is optional.
14. Tax: only IGST/CGST/SGST/cess percentages (cess ad-valorem only; specific-amount cess and composition-scheme flat rates are not modelled). Permissions `tax:manage` and `pricing:manage` are separate from `masterdata:write`.
15. Price lists: one price per (list, item, unit, minimum quantity, period); customer-specific lists and discounts/schemes are not modelled yet.
16. Accounting: fiscal years are 12 calendar months starting on the 1st (a short first year is not supported); periods are monthly; periods close strictly in order. Reopening needs `accounting:reopen`; locking is irreversible.
17. Entries are in the company's **base currency only**. Foreign-currency postings arrive with the sales/purchase documents (they will carry the foreign amount and rate as memo columns next to base amounts).
18. No draft/approval workflow for manual journals yet (posting is immediate, controlled by period, account and permission rules); no recurring journals, no year-end close / retained-earnings roll-up (the trial balance shows income and expense accounts as they are), no budgets, no dimensions beyond business location and party on a line.
19. `entry_no` is not required to be gapless; a rolled-back posting returns its number, so committed numbers are consecutive in practice.
20. Inventory: valuation is per item per warehouse (not company-wide); one GL account per item *type* (not per item); quantities are in the item's base unit (conversions are applied by documents); no movement reversal yet; no item categories or landed cost yet (purchasing slice).
21. Negative-stock valuation is approximate by nature (shortfalls use the last cost); the subledger and GL still agree because both take the same ledger values.
22. Counts: one adjustment per count; no recount/approval workflow; serial items are checked by serial adjustments instead. Transfers: same company only (inter-company is out of scope), no transport/charges, in-transit stock has no separate GL account (it stays in the item's inventory account).
23. Reservations are by warehouse (and optional batch); no cross-warehouse allocation, no priority/pre-emption, serial items not reservable.
24. Sales: an invoice's place of supply must be one state (mixed goods/services with different places must be split into two invoices); selling unit = the item's base unit; a bill of supply applies no tax at all; regular supplier + bill of supply is allowed and tax-free (you confirm when that is legally right); only regular, composition and SEZ registrations issue sales documents.
25. Receivables are tracked as journal lines with the customer as a dimension on the receivables control account; allocation of receipts and ageing arrive in 5c.
11. Retention: nothing is ever deleted by the runtime role (no DELETE grants), so sessions, idempotency keys, outbox and audit rows accumulate; archival/partitioning needs a separate maintenance role and a retention policy you must decide.

## Deferred on purpose (later slices, not decided here)
Ledgers and posting (immutable, double-entry, period locks, inventory subledger reconciliation); effective-dated tax rules;
document numbering per GST registration and financial year (cancelled numbers preserved, no global gapless counter); offline-sync conflict rules (aggregates already carry `version`/`updated_at`); vendor telemetry (not wired).
The legacy `server/` directory is untouched.
