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
| schema_migrations | applied files + sha256 | owner-only (not granted to erp_app except read for readiness) |

Grants to `erp_app`: `SELECT, INSERT, UPDATE` only. Policy on every table: `tenant_isolation TO erp_app USING / WITH CHECK (tenant_id = erp.current_tenant_id())`, with `ENABLE` and `FORCE ROW LEVEL SECURITY`.
Exact DDL: `db/migrations/0001_foundation.sql`, `0002_tenancy.sql`.

## Migration strategy
Forward-only; to undo, add a new migration. Expand/contract for breaking changes. Run as `erp_migrator` before the new app version starts
(compose and CI do this). `npm run db:status` lists applied/pending. Never edit an applied file (the runner refuses).
