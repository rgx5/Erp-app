# Database (schema `erp`)

Roles: `erp_migrator` (owner, migrations only) · `erp_app` (runtime, restricted). Bootstrap: `db/bootstrap/bootstrap.sql`.
Functions: `erp.current_tenant_id()` (reads `app.tenant_id`), `erp.touch_row()` (bumps `version`, `updated_at`).
Every table has `version int`, `created_at`, `updated_at`; PK `(tenant_id, id)` except `tenants(id)`.

| table | purpose | key constraints |
| --- | --- | --- |
| tenants | customer account | RLS: `id = current tenant` |
| companies | legal entity | unique (tenant, code); PAN format check; FY start month |
| gst_registrations | GSTIN of a company (many per company) | gstin `char(15)` regex; `state_code = substr(gstin,1,2)`; type check; effective_from/to; unique (tenant, gstin); trigger: PAN in GSTIN = company PAN |
| business_locations | branch/site | FK (tenant, company, gst_registration) → registration of the same company; one principal per registration |
| warehouses | stock location | FK to location; `kind` check list |
| tenant_directory | slug -> tenant id for sign-in (**not** tenant-scoped; trigger-filled; read-only to erp_app) | pk slug |
| users | people who sign in | unique (tenant, email) lower-case; argon2id hash; MFA seed encrypted; lockout counters; custom trigger so sign-in bookkeeping does not bump `version` |
| roles / user_roles | permission sets; assignments (revoked by timestamp, never deleted) | unique (tenant, lower(name)); owner role `is_system` |
| sessions | one row per refresh token (rotating), `family_id` groups a login | SHA-256 token hash unique per tenant; `used_at`/`revoked_at` |
| api_keys | integration credentials | SHA-256 of secret; permission array; expiry; revoked_at |
| mfa_recovery_codes | single-use recovery codes (hashed) | unique (tenant, user, hash) |
| audit_log | append-only audit trail | INSERT/SELECT only + reject trigger for UPDATE/DELETE/TRUNCATE; action format check |
| idempotency_keys | request dedupe with stored response | pk (tenant, key); expiring |
| outbox_events | domain events, immutable | trigger rejects UPDATE/DELETE; insert enqueues a dispatch pointer |
| outbox_consumed | (event, consumer) done-marks | composite FK to the event |
| outbox_dispatch | delivery queue, pointers only (**not** tenant-scoped; trigger-filled) | partial index on due work; erp_app may SELECT/UPDATE only |
| number_series | one per GST registration x document type x financial year | composite FK to gst_registrations; format checks; unique scope |
| number_allocations | every number ever issued | unique (tenant, series, value); 16-char/charset check; trigger allows only issued -> cancelled |
| schema_migrations | applied files + sha256 | owner-only (not granted to erp_app except read for readiness) |

Grants to `erp_app`: `SELECT, INSERT, UPDATE` only (audit_log, outbox_events, outbox_consumed: `SELECT, INSERT` only; number_allocations: `SELECT, INSERT` + `UPDATE` on the three cancellation columns). Policy on every table: `tenant_isolation TO erp_app USING / WITH CHECK (tenant_id = erp.current_tenant_id())`, with `ENABLE` and `FORCE ROW LEVEL SECURITY`.
Exact DDL: `db/migrations/0001_foundation.sql` ... `0004_platform_services.sql`.

**Tables outside RLS**: exactly three, enforced by a test: `schema_migrations` (metadata), `tenant_directory` (slug -> id), `outbox_dispatch` (queue pointers). The test also pins their column lists so business data cannot creep into them.

## Migration strategy
Forward-only; to undo, add a new migration. Expand/contract for breaking changes. Run as `erp_migrator` before the new app version starts
(compose and CI do this). `npm run db:status` lists applied/pending. Never edit an applied file (the runner refuses).
