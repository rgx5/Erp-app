# Testing, RLS verification, performance

`npm run test:all` = 26 unit tests + 75 integration tests, all green. Integration tests create a fresh database per run, bootstrap roles,
migrate as `erp_migrator`, then connect as the real `erp_app` role.

| suite | covers |
| --- | --- |
| unit | GSTIN/PAN validation, request schemas, env rules (production refuses dev-header), problem+json mapping, validation pipe |
| migrations.int | apply, idempotence, checksum tamper / missing / out-of-order rejection, failed-file rollback, Drizzle-vs-DB drift |
| tenant-isolation.int | RLS meta-test (ENABLE+FORCE+policy and tenant_id in PK/FK on **every** table), cross-tenant read/write/FK attempts, no tenant set => zero rows, role safety (not owner/superuser/BYPASSRLS, no DELETE), **120 concurrent transactions over a 2-connection pool with injected failures show no leakage** |
| organization-api.int | full HTTP API on **both adapters**: validation, problem+json, If-Match, pagination, GST rules, platform token, health/readiness (503 when migrations behind), startup refusal for unsafe DB role |

Not verified here: the Docker build and the GitHub Actions workflow (no Docker daemon in this sandbox; the workflow has not run yet).

## Performance baseline (4 vCPU, 32 connections, 6 s, `npm run perf`)
Fastify: live 16,188 req/s; GET /v1/tenant 1,917; list companies 1,191; POST company 1,824.
Tenant transaction wrapper: mean 0.282 ms vs 0.060 ms for a bare `SELECT 1` (≈0.22 ms RLS/tx overhead).
Numbers are a regression baseline on a shared sandbox, not capacity claims.
