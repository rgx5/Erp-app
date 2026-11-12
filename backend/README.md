# OneSyncERP backend (Slice 0 + Slice 1)

NestJS 12 modular monolith on PostgreSQL 16 with Drizzle. Slice 0 is the platform foundation and the tenancy hierarchy
**Tenant → Company → GST registration → Business location → Warehouse**. Slice 1 adds identity (users, roles, sessions, API keys, MFA), the audit log, idempotency, the transactional outbox and document number series. No business modules yet.

Docs: [ARCHITECTURE.md](docs/ARCHITECTURE.md) (decisions) · [DATABASE.md](docs/DATABASE.md) (schema, RLS, migrations) ·
[TESTING.md](docs/TESTING.md) (tests, RLS verification, performance) · [openapi.json](docs/openapi.json) (API; also `/docs` when running).

## Run
```bash
docker compose up --build            # postgres + migrations + api on :8080
# or locally (needs npm >= 11, Node >= 22.22):
npm ci
bash scripts/pg-local.sh             # throwaway PostgreSQL on :5434 (dev only)
npm run test:all
```
Roles/schema bootstrap is a one-time admin step (`npm run db:bootstrap`), migrations run as the owner role
(`npm run db:migrate`), the API runs as the restricted `erp_app` role and refuses to start if that role is unsafe.

## Layout
```
backend/
  db/bootstrap/bootstrap.sql     roles + schema (admin, once)
  db/migrations/NNNN_*.sql       forward-only SQL, checksummed
  src/config                     zod-validated environment
  src/db                         migrator, bootstrap, Drizzle schema mirror, migration CLI
  src/platform/{database,http,logging,health,tenancy}
  src/modules/organization       tenancy hierarchy API
  src/modules/identity           authentication, users, roles, API keys, MFA
  src/modules/audit, numbering   audit-log read API; document number series
  src/platform/services          audit writer, idempotency, outbox + relay
  test/integration               real PostgreSQL, the real erp_app role
  scripts/                       perf, bootstrap, openapi export
```
