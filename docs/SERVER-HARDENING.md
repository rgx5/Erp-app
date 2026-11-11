# Server hardening roadmap (NestJS)

Status: **proposal** — decisions marked *(decide)* need an owner before the phase that depends on them starts.

The backend in `server/` (see [SERVER.md](./SERVER.md)) is a small, correct core: about 1,600 lines of TypeScript on Fastify and
raw `pg`, nine integration suites against a real PostgreSQL, and a live-sync suite, all running in CI. It was built to be
"small and boring on purpose". This plan keeps that core and grows it into something an enterprise customer can put through
a security review and a load test. **The backend will be NestJS** (on the Fastify adapter), and the replication engine stays
exactly where it is.

## 1. Where the server stands today

What follows is from reading the code, not from the docs alone.

| Area | Today | Why it matters at enterprise scale | Phase |
| --- | --- | --- | --- |
| Structure | Hand-wired Fastify: `buildApp` plus `registerXRoutes(app, ctx)`; auth is a per-route `preHandler`; validation is hand-written (`validate.ts`). | Fine at 1.6k lines; no consistent place for guards, DTOs, OpenAPI, jobs or modules as it grows. | 1 |
| Tenant isolation | Every query carries `org_id` by convention (`PgDocStore`); one test proves org A cannot reach org B. No database-level enforcement. | One missed `WHERE org_id` in a future query leaks a tenant. Enterprise reviews ask for defence in depth. | 2 |
| Write path | Every push locks the org's row (`SELECT … FOR UPDATE`) and takes the next value of one per-org revision counter. | All writes inside one org are serialised. Fine for a shop; a ceiling for a chain with many branches and tills. | 2 (measure first) |
| First sync | `GET /sync/pull?since=0` downloads the org's whole history; one `(org_id, rev)` index. | A new device at a large org downloads years of documents; `mutations` and tombstones grow without bound. | 2 |
| Reporting | Documents are JSONB in one `docs` table; the *app* computes every report from synced documents. | No server-side queries, so no reports without syncing everything, and nothing for BI tools or read replicas to serve. | 2 |
| Trust | The server stores a bill's totals and tax as the client computed them (stated in SERVER.md). | A modified client can post wrong money. SERVER.md already names server-side recompute as the next step. | 2 |
| Authentication | HS256 JWT with one shared secret, 12 h lifetime; `bcryptjs` (pure JS); no MFA, no SSO. | Standard enterprise requirements: key rotation, short tokens, MFA, SSO, stronger hashing. | 3 |
| Principal cache | Resolved per request, cached 5 s in a per-process `Map`; `invalidate()` clears only that process. | With several pods, a revoked device or changed role can keep working for up to 5 s on the others. | 4 |
| Audit | Documents carry `updated_by`; no history, no audit log. | Enterprise and statutory audit-trail requirements. | 3 |
| Backup | `GET /backup` returns a whole org as one JSON document. | Does not scale and is not point-in-time recovery. | 2 |
| Operations | `SERVER.md` says `docker compose up`, but I found no Dockerfile or compose file in the repo. `/health` is `SELECT 1`. Logging is Fastify's; no metrics or tracing. One migration file and a 33-line runner. | Nothing to deploy, observe, or roll forward safely. | 1 / 4 |
| Process model | One process; no queue, no workers. | E-invoicing, reminders and recurring invoices need retries and schedules, not request threads. | 4 |
| Tests | Nine server suites plus live sync, against real PostgreSQL in CI. | This is the asset: it is the safety net for the whole migration. | — |

## 2. Target shape

NestJS hosts the server; it does not own the rules. Rule of thumb: **`src/replication`, `src/domain` and the modules'
`replication.ts` never import `@nestjs/*`.** They stay pure TypeScript shared with the app, and the server only calls them.

```
server/src/
  main.ts                 bootstrap (HTTP)
  app.module.ts
  config/                 validated env (same variable names and defaults as today)
  database/               pool provider, UnitOfWork (tx + org lock + SET LOCAL app.org_id), migrations
  common/                 exception filter → { error, code }, pipes, @Perm / @Principal / @Public decorators
  auth/                   JWT + permission guards, PrincipalResolver, tokens, passwords, throttling
  sync/                   thin controller over applyMutations / pullChanges; PgDocStore unchanged
  orgs/ users/ roles/ branches/ devices/ api-keys/ files/ share/ backup/
  audit/                  audit-log writer and query
  reports/                server-side report queries (Phase 2)
  health/                 liveness / readiness (Terminus)
apps/worker/              BullMQ processors — same codebase and image, separate entrypoint (Phase 4)
```

Choices and why:

* **Fastify adapter** (`@nestjs/platform-fastify`) rather than Express: same performance profile as today, and the existing
  tests drive the app with `inject`, which the adapter supports.
* **SWC builder** (`nest build --builder swc`), not the current esbuild script: Nest's constructor injection needs
  decorator metadata, which esbuild does not emit. The `@/*` → `../src/*` alias that lets the server load the app's shared
  code must keep working under it.
* **Query layer: Kysely (typed SQL) plus SQL migrations, not a full ORM** *(decide)*. The replication code depends on explicit
  `FOR UPDATE` locks, `SAVEPOINT`s and `REPEATABLE READ` snapshots, which ORMs tend to hide. Raw `pg` inside `PgDocStore` can
  stay as it is.
* **The wire contract is frozen.** [API-CONTRACT.md](./API-CONTRACT.md) is what the shipped apps speak. Every phase below is
  additive or behind versioning.

## 3. Phases

Sizes are relative (S ≈ days, M ≈ 1–3 weeks, L ≈ a month or more). Phases 2 and 3 can run in parallel once Phase 1 lands.

### Phase 0 — Spikes and decisions (S)

* [ ] **Spike: Nest on the existing Fastify instance.** Confirm `NestFactory.create(AppModule, new FastifyAdapter(existingInstance))`
  lets legacy `registerXRoutes` keep serving beside Nest controllers. If not, fall back to mounting the legacy routes as a
  Fastify plugin inside the Nest app.
* [ ] **Spike: build.** SWC builder with the `@/*` alias; prove the shared pure code compiles with no React Native imports;
  run the nine suites and live sync under it. Add a lint rule forbidding `@nestjs/*` imports outside `server/`.
* [ ] **Baseline.** k6 scenarios (many tills pushing bills, a pull storm after an outage, first-sync of a large org) on a
  seeded org, so "no regression" and the Phase 2 lock decision are measurable.
* [ ] **Decisions** *(decide)*, each as a short ADR: org structure (org → legal entity → branch, multi-GSTIN, multi-currency)
  because it is cheap now and painful later; deployment target and managed PostgreSQL; first SSO identity providers;
  compliance targets (India DPDP Act 2023, the MCA audit-trail rule for accounting software, SOC 2 / ISO 27001); and scale
  targets (orgs, branches per org, devices per org, writes per second per org).

Exit: spikes pass, baseline recorded, ADRs written.

### Phase 1 — Move to NestJS, no behaviour change (M–L)

Strangler inside one process: port one route group at a time, keep every step shippable. Order, lowest risk first: health →
org / branches / devices → users / roles / API keys → files / share / backup → auth → **sync last** (it is a thin controller
over `applyMutations` / `pullChanges`, but it is the part that must never regress).

* [ ] Config module with validated env; production still refuses a missing or short `JWT_SECRET`.
* [ ] Database module: pool provider and a `UnitOfWork` replacing `withTx` / `withOrg` (transaction, `lockOrg`, read-only
  `REPEATABLE READ` for pulls). `PgDocStore` unchanged.
* [ ] Auth module: global JWT guard with `@Public()` opt-out; `@Perm('settings')` plus a permissions guard instead of per-route
  checks; `PrincipalResolver` as a provider.
* [ ] DTOs and `ValidationPipe` replacing `validate.ts`. Messages the app shows to people stay identical.
* [ ] Global exception filter producing exactly `{ error, code }`, including `Retry-After` on 429 and today's 413 / 415 handling.
* [ ] OpenAPI generated from the DTOs (`@nestjs/swagger`), with a CI check that it matches API-CONTRACT.md.
* [ ] Health via Terminus: `/health` keeps `{ app, version, ok, time }` (the app reads `app`); add `/health/live` and `/health/ready`.
* [ ] **Add the missing Dockerfile and `docker-compose.yml`** that SERVER.md promises.
* [ ] Test harness: `startServer()` builds a Nest testing module instead of `buildApp`; the nine suites themselves do not change.

Exit: nine suites and live sync green with unchanged assertions; contract diff against API-CONTRACT.md is clean; k6 baseline
within ±10%; the legacy `app.ts` and `routes/` are deleted.

### Phase 2 — Data layer: isolation, integrity, scale, reporting (L)

1. **Migrations.** Real migration tooling (Kysely migrations or node-pg-migrate) replaces `migrate.ts`. Expand/contract
   discipline so rolling deploys work; a CI check on every migration.
2. **Row-level security.** RLS on every tenant table (`org_id = current_setting('app.org_id')`), set per transaction with
   `SET LOCAL` in `UnitOfWork`; the API connects as a role without `BYPASSRLS`. Extend `tenancy.test.ts` to attack through raw
   SQL with the wrong org set. Exit: a deliberately broken query without an `org_id` filter returns nothing.
3. **Write-path scalability — a decision gate, not a rewrite.** Run the Phase 0 scenarios at the agreed scale. Only if push
   latency misses the target: shorten the critical section; or move hot owned numbers (stock on hand, balances) to row-level
   increments; or move to per-branch revision streams with vector cursors (a breaking `cursor` change that needs an API version
   and an app release). Do not pay this cost unless the measurements demand it.
4. **Sync at scale.** Bootstrap snapshots for new devices (compressed NDJSON per org in object storage, then delta from the
   snapshot's revision); sync scopes so old ledger documents are fetched on demand instead of pushed to every device; track each
   device's cursor so tombstones below the minimum can be compacted; a retention window on `mutations` longer than the longest
   expected offline period, enforced by partition drop; extra indexes (`(org_id, coll, updated_at)`), and hash-partitioning
   `docs` by org only when row counts require it.
5. **Reporting layer.** An outbox or projector reads the revision log and builds relational read models (bills and lines,
   stock movements, ledger entries, party balances, tax summaries) plus materialized views for dashboards. Server-side report
   endpoints (GST, profit, stock valuation, ageing) call the **same pure functions** the app uses, with differential tests that
   assert server report == app report on the same org. Read-replica routing for `reports/*` only; sync push and pull stay on the
   primary, because replica lag would break read-your-own-writes for devices.
6. **Server as judge for money rules.** Recompute bill totals and tax with the shared `src/domain` code and reject mismatches;
   enforce accounting period locks (the app already has "Years & locks"), negative-stock rules, and credit limits on the server
   through the registry's `validate` hooks.
7. **Backup and recovery.** Point-in-time recovery (WAL archiving or a managed service), written RPO / RTO targets, and a
   restore drill. Keep per-org export for portability but stream it as NDJSON rather than one JSON document.

Exit: RLS test passes; first sync of a very large seeded org stays within an agreed size and time; report parity tests green;
a restore drill has been run end to end.

### Phase 3 — Security and compliance (L)

1. **Tokens.** Asymmetric signing (EdDSA or RS256) with `kid`, a JWKS endpoint and rotation; 15-minute access tokens with
   rotating refresh tokens and reuse detection. Keep the `token_ver` / `session_ver` revocation semantics. *Check first that
   the app's existing refresh flow copes with a short lifetime.*
2. **Credentials.** argon2id with rehash on next login, password policy and breached-password check; TOTP MFA with recovery
   codes, required for owner and manager roles (configurable per org); step-up for sensitive actions.
3. **SSO.** OIDC first (Google, Microsoft Entra), then SAML 2.0 for enterprise IdPs; just-in-time provisioning with role
   mapping; an "enforce SSO" org setting; SCIM provisioning later.
4. **Authorization.** Keep the permission strings; add a policy layer (CASL or custom guards) for conditions — branch scope,
   amount and discount limits — and maker-checker approvals for purchase orders, returns and write-offs, with a permission-matrix test.
5. **Audit trail.** Append-only `audit_log` (who, device, IP, action, collection and id, before/after, request id) written in
   the **same transaction** as the change, hash-chained per org for tamper evidence, plus edit history for master documents and
   a query / export API. India's MCA rule requires accounting software to keep a non-disableable audit trail — *confirm
   applicability with the customer's auditors*.
6. **Data protection.** TLS everywhere; encryption at rest; envelope encryption (KMS) for sensitive columns (phone, email,
   GSTIN / PAN, bank details); secrets in a manager rather than env files; log redaction extended beyond the `Authorization` header.
7. **Privacy.** DPDP Act: consent records, access and erasure requests, and a way to anonymise a customer's personal data while
   keeping ledger amounts intact (ledger documents are immutable); a retention schedule; a breach-notification runbook.
8. **API hardening.** `@nestjs/throttler` with a Redis store (per IP, org and API key); API-key scopes, rotation with a grace
   period and optional IP allow-lists; per-org CORS allow-list instead of today's single env list; signed webhooks.
9. **Supply chain and testing.** Dependency audit and Renovate, SBOM, container image scan, CodeQL, secret scanning, DAST
   against staging, and an independent penetration test before the first enterprise customer.

Exit: pen test with no high findings; a test proving every write path emits an audit row; SSO and MFA flows covered end to end.

### Phase 4 — Scale and operations (L)

1. **Redis.** Shared `PrincipalResolver` cache (closes the per-pod invalidation gap), throttler store, queues.
2. **Workers (BullMQ).** E-invoice (IRN) and e-way bill with retry, backoff and dead-letter; recurring invoices; payment
   reminders; day-close; nightly projection refresh; tombstone compaction and retention purges; notifications. Use a
   **transactional outbox**: events are written in the same transaction as the document and relayed by a worker
   (at-least-once, so consumers are idempotent).
3. **Realtime.** SSE or WebSocket ("changes available for org X", fanned out over Redis pub/sub) so devices pull immediately;
   polling stays as the fallback.
4. **Files.** S3-compatible `FileStore` driver (the interface already exists): presigned upload and download, antivirus scan,
   per-org quotas, async thumbnails, migration of existing disk files.
5. **Topology.** Stateless API pods with autoscaling; PgBouncer in transaction mode (compatible with `SET LOCAL` and
   per-transaction locks — verify `SAVEPOINT` and `REPEATABLE READ` under it); a connection-budget calculation; graceful
   shutdown that drains in-flight pushes; readiness gates.
6. **Observability.** OpenTelemetry traces (HTTP → DB → queue); Prometheus metrics (push / pull latency, batch sizes, org-lock
   wait, effect failures, queue depth, pull lag); structured logs with request, org and device ids and no personal data;
   error tracking; dashboards and alerts. Starting SLOs to tune against Phase 0 numbers: push p95 < 300 ms, pull p95 < 500 ms,
   99.9% monthly availability.
7. **Delivery.** Multi-stage, non-root container image; infrastructure as code; dev / staging / production; CI additions
   (migration check, OpenAPI diff, image scan, load-test smoke); blue/green or canary releases with expand/contract
   migrations; feature flags.
8. **Scale-out options, only if measured.** Org-to-shard routing (application-level or Citus); a "silo" tier with a dedicated
   database per large enterprise tenant via a tenant registry; a standby region with a tested failover.

Exit: load test at the agreed scale meets the SLOs; a kill-and-restart test loses no acknowledged write; a failover drill passes.

### Phase 5 — Enterprise capabilities (ongoing, demand-driven)

* **Public API and webhooks:** versioned REST with the generated OpenAPI spec, HMAC-signed webhooks with retries and a delivery log.
* **Integrations:** GST (IRP e-invoice, GSTR-1 / 3B JSON), e-way bill, payment gateways and bank reconciliation, server-side
  Tally export, SFTP / CSV pipelines.
* **Org structure:** legal entities, multi-GSTIN, multi-currency, inter-company and consolidation (depends on the Phase 0 ADR).
* **Workflow:** a general approvals engine (generalising purchase-order approvals) and notification preferences.
* **Admin console:** tenant operations, usage metering and plan limits, per-org feature flags, support impersonation with audit.
* **Data lifecycle:** archival to cold storage, legal hold, deletion workflows.

## 4. Sequencing

| Phase | Size | Depends on | Notes |
| --- | --- | --- | --- |
| 0 Spikes and decisions | S | — | Gates everything; the ADRs size Phases 2 and 4. |
| 1 NestJS migration | M–L | 0 | All later work lands on the final structure. Dockerfile and CI hardening can start immediately. |
| 2 Data layer | L | 1 | Item 3 (write path) is conditional on measurements. |
| 3 Security and compliance | L | 1 | Runs in parallel with 2; item 5 (audit) touches the write path, so coordinate with 2. |
| 4 Scale and operations | L | 1; partly 2 | Redis and observability can start during Phase 2. |
| 5 Enterprise capabilities | ongoing | 2, 3 | Prioritised with customers. |

Rough guide, to be re-estimated after Phase 0: with two or three backend engineers, Phases 0–1 take about 4–6 weeks, Phases
2–3 about three to four months in parallel, Phase 4 about two to three months overlapping, Phase 5 continues indefinitely.

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| Sync regresses during the move (highest-impact failure). | Port it last; the nine suites and live sync must stay green with unchanged assertions; replay recorded push / pull traffic against old and new implementations in CI. |
| Nest decorators leak into the shared pure code and break the app bundle. | Lint rule banning `@nestjs/*` outside `server/`; the Expo bundle check in CI already catches leaks. |
| esbuild cannot emit decorator metadata, so constructor injection breaks. | SWC builder (Phase 0 spike), or explicit `@Inject(...)` tokens. |
| Wire contract drifts from what shipped apps speak. | Frozen API-CONTRACT.md, contract tests, OpenAPI diff in CI. |
| RLS combined with PgBouncer: `SET LOCAL` only works inside a transaction. | `UnitOfWork` always opens one; add a test that fails if a query runs outside it. |
| Premature scaling work (sharding, vector cursors) adds complexity nobody needs yet. | Gate on Phase 0 measurements and the agreed scale targets. |
| Compliance assumptions are wrong for a given customer. | Treat the DPDP / MCA / SOC 2 items as targets to confirm with the customer's advisers, not as settled requirements. |

## 6. What I could not verify

This plan comes from reading `docs/SERVER.md`, the schema, `app.ts`, `pgDocStore.ts`, `principal.ts`, `db.ts`, `routes/sync.ts`,
`config.ts`, the build script, the test harness and CI. I did not read the other route files in detail, and I have not run a
Nest spike. Items to confirm before relying on them: Nest booting on an existing Fastify instance, PgBouncer behaviour with
`SAVEPOINT` and `REPEATABLE READ`, the app's token-refresh handling at short lifetimes, and the regulatory points above.
