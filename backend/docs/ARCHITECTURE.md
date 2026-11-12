# Architecture decisions (Slices 0-2)

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
11. Retention: nothing is ever deleted by the runtime role (no DELETE grants), so sessions, idempotency keys, outbox and audit rows accumulate; archival/partitioning needs a separate maintenance role and a retention policy you must decide.

## Deferred on purpose (later slices, not decided here)
Ledgers and posting (immutable, double-entry, period locks, inventory subledger reconciliation); effective-dated tax rules;
document numbering per GST registration and financial year (cancelled numbers preserved, no global gapless counter); offline-sync conflict rules (aggregates already carry `version`/`updated_at`); vendor telemetry (not wired).
The legacy `server/` directory is untouched.
