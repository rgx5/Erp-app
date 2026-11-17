# Deployment guide

## Roles and database
1. Create the database and run `npm run db:bootstrap` (as a superuser) to create `erp_migrator` (owns tables, runs migrations) and `erp_app` (runtime; no ownership, no BYPASSRLS, no DELETE).
2. `MIGRATOR_DATABASE_URL=... npm run db:migrate` on every release, before starting new instances. `npm run db:status` shows what is pending.
3. The application starts with `DATABASE_URL` set to the runtime role and refuses to boot if that role can bypass RLS or owns tables.

## Required in production
`DATABASE_URL`, `AUTH_JWT_PRIVATE_KEY` (Ed25519 PKCS#8 PEM; rotate by adding the old public key to `AUTH_JWT_PREVIOUS_PUBLIC_KEYS`), `DATA_ENCRYPTION_KEY` (32 random bytes, base64). Optional: `PLATFORM_ADMIN_TOKEN` (>= 32 chars) to enable tenant provisioning, `SELF_SIGNUP_ENABLED`, `SWAGGER_ENABLED`.

## Tuning
| Variable | Default | Notes |
|---|---|---|
| `DATABASE_POOL_MAX` | 20 | per instance |
| `RATE_LIMIT_PER_WINDOW` / `RATE_LIMIT_WINDOW_SECONDS` | 0 (off) / 60 | per instance, per client address |
| `AUTH_PRINCIPAL_CACHE_TTL_MS` | 0 (off) | max 60000; bounds staleness of DB-side revocations |
| `OUTBOX_RELAY_ENABLED`, `OUTBOX_*` | see `src/config/env.ts` | any number of instances may run the relay |
| `IDEMPOTENCY_TTL_SECONDS` | 86400 | |
| `CORS_ALLOWED_ORIGINS` | empty (none) | comma-separated exact origins, never `*`; the desktop client uses `app://onesync` |

## Client discovery
`GET /v1/meta` (public) tells a client that this is a OneSyncERP server, its API version and which sign-in modes are on.

## Scaling
Instances are stateless; scale horizontally behind a load balancer. Health: `/health`, `/live`, `/ready`. Per-instance state is limited to the optional rate limiter and principal cache. Configure the proxy to forward the real client address and apply a global limit at the edge.

## Retention schedule
Run daily as the migrator role: `MIGRATOR_DATABASE_URL=... npm run maintenance:retention` (use `-- --dry-run` first). It purges expired idempotency keys, delivered outbox events and long-expired sessions in batches. Audit and ledgers are never purged.

## Backups
Take continuous WAL archiving plus daily base backups; test restores. Ledgers are append-only, so point-in-time recovery is the only recovery path for data errors (corrections are reversals, never edits).

## Security checklist
TLS at the edge; secrets from a secret manager; `SELF_SIGNUP_ENABLED` off; `SWAGGER_ENABLED` off or network-restricted; separate migrator and runtime credentials; alert on 5xx, `/ready` failures and outbox dead letters.
