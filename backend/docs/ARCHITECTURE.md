# Architecture decisions (Slice 0)

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

## ADR-7 Identity (Slice 0 placeholder) — important
There is **no authentication yet**. Tenant resolution is the `X-Tenant-Id` header (`AUTH_MODE=dev-header`), which is not security.
Config **refuses to start with `NODE_ENV=production` and dev-header**, so this cannot be deployed by accident. Tenant creation requires a
`PLATFORM_ADMIN_TOKEN` (>= 32 chars, constant-time compare; endpoint 404 when unset). Real identity is a later slice.

## Assumptions to confirm
1. GST registration types: regular, composition, SEZ, casual, non-resident, input-service-distributor, TDS/TCS deductor (check constraint list, easy to change).
2. GSTIN: 15 chars, format regex, state code = first two digits, PAN inside GSTIN must equal the company PAN. State code validity table is not enforced. A GSTIN is unique per tenant.
3. Business location's `gst_registration_id` is nullable (non-GST site); at most one *principal* location per registration.
4. Financial-year default is April–March (company setting, not yet used by any posting).
5. No DELETE privilege for the app role anywhere (soft-state via `active`/effective dates).
6. Warehouse kinds list above.

## Deferred on purpose (later slices, not decided here)
Identity/RBAC; ledgers and posting (immutable, double-entry, period locks, inventory subledger reconciliation); effective-dated tax rules;
document numbering per GST registration and financial year (cancelled numbers preserved, no global gapless counter); outbox + idempotency keys;
append-only audit log; offline-sync conflict rules (aggregates already carry `version`/`updated_at`); vendor telemetry (not wired).
The legacy `server/` directory is untouched.
