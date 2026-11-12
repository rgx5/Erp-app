# Testing, RLS verification, performance

`npm run test:all` = 48 unit tests + 135 integration tests, all green (the integration suite also passes with `TEST_HTTP_ADAPTER=node`). Integration tests create a fresh database per run, bootstrap roles,
migrate as `erp_migrator`, then connect as the real `erp_app` role.

| suite | covers |
| --- | --- |
| unit | GSTIN/PAN validation, request schemas, env rules (production refuses dev-header), problem+json mapping, validation pipe |
| migrations.int | apply, idempotence, checksum tamper / missing / out-of-order rejection, failed-file rollback, Drizzle-vs-DB drift |
| tenant-isolation.int | RLS meta-test (ENABLE+FORCE+policy and tenant_id in PK/FK on **every** table), cross-tenant read/write/FK attempts, no tenant set => zero rows, role safety (not owner/superuser/BYPASSRLS, no DELETE), **120 concurrent transactions over a 2-connection pool with injected failures show no leakage** |
| identity.int | sign-in and its uniform failures, lockout, rotating refresh + reuse detection, logout, password change, MFA (enrol, replay, recovery codes, encryption at rest), permissions applied on the next request, privilege-escalation and last-owner rules, optimistic locking, API keys (scope, revoke, expiry, wrong tenant), cross-tenant identity isolation, self-signup default-off |
| platform-services.int | audit (who/what/request id, no secrets, rollback leaves nothing, append-only even for a superuser, tenant-scoped reads), idempotency (replay, conflict, 12 simultaneous duplicates -> one effect, failed request does not burn the key, tenant/caller scoping, expiry), outbox (commit-only publish, per-tenant delivery context, redelivery no-op, backoff, dead-letter, concurrent relays, background loop + clean shutdown) |
| numbering.int | series config rules, consecutive numbers, **40 concurrent allocations -> no duplicate, no gap**, rollback returns the number, cancelled numbers kept and never reissued, per-registration/per-year independence, 16-char rule, append-only ledger |
| organization-api.int | full HTTP API on **both adapters**: validation, problem+json, If-Match, pagination, GST rules, platform token, health/readiness (503 when migrations behind), startup refusal for unsafe DB role |

Not verified here: the Docker build and the GitHub Actions workflow (no Docker daemon in this sandbox; the workflow has not run yet).

## Performance baseline (4 vCPU shared with the load generator and PostgreSQL, 32 connections, 5 s, `npm run perf`)
| scenario | Fastify req/s | Node adapter req/s |
| --- | ---: | ---: |
| GET /health/live | 11,712 | 11,348 |
| GET /v1/tenant (auth + 1 read tx) | 607 | 695 |
| GET /v1/companies?limit=50 | 516 | 544 |
| POST /v1/companies (auth + write + audit + outbox) | 614 | 574 |

Tenant transaction wrapper: mean 0.38 ms vs 0.08 ms for a bare `SELECT 1`.

**Authentication roughly triples the cost of a database request** (GET /v1/tenant was ~1,900 req/s with the Slice 0 dev header, p50 ~16 ms; now ~600 req/s, p50 ~50 ms). Cause: every request re-validates the principal against the database in its own transaction (8 statements per request instead of 4) plus ~0.12 ms Ed25519 verification. I optimised that lookup to a single query; the remaining options trade freshness for speed and I have not taken them without your decision: (a) a 1-5 s in-process principal cache (role changes/logout would lag by up to that long), or (b) running the handler in the same transaction as the principal lookup. Numbers are a shared-sandbox regression baseline, not capacity claims.
