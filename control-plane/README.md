# OneSyncERP control plane

The small central service above all client sites (see `docs/DEPLOYMENT-PLAN-FINAL.pdf`). It holds **no client business data**, only:

- **clients and sites** (tier, tenant id, release ring, maintenance window, paused updates);
- **licences**: signed (Ed25519) documents that a product server verifies with its `LICENCE_PUBLIC_KEY`;
- **releases**: signed manifests, opened ring by ring (0 = your own site, 1 = friendly sites, 2 = everyone);
- **heartbeats** from each site's agent and the derived **fleet health** (healthy, degraded, silent, never seen);
- **staff** (admin, support, viewer) and an **audit** of everything they did.

## Run it

```
createdb controlplane
npm ci
npm run cli -- keys                        # two key pairs: set the private keys below, give servers the licence public key
export DATABASE_URL=postgres://... LICENCE_PRIVATE_KEY="$(...)" RELEASE_PRIVATE_KEY="$(...)"
CP_PASSWORD='a-long-password' npm run cli -- create-staff you@example.com "Your Name" admin
npm start                                  # http://127.0.0.1:8090/ui is the fleet screen
```

`GET /keys` returns the public keys; `LICENCE_PUBLIC_KEY` on each product server must be the licence one.

## What an agent calls (token: `cpa_<siteId>_<secret>`, issued once with `POST /sites/:id/agent-token`)

| Call | Purpose |
|---|---|
| `POST /agent/heartbeat` | report version, database, backups, disk, tunnel (stored, and judged for the fleet screen) |
| `GET /agent/licence` | the newest signed licence, to import with `POST /v1/platform/tenants/:id/licence` on the site's server |
| `GET /agent/release?current=1.2.3` | the signed manifest to move to (nothing while updates are paused or up to date) |

## Staff API

Sign in with `POST /auth/login`; then `GET /fleet`, `GET /sites/:id`, `POST /clients`, `POST /sites`, `PATCH /sites/:id`, `POST /sites/:id/licences`, `POST /licences/:id/revoke`, `POST /releases`, `POST /releases/:id/promote`, `POST /releases/:id/withdraw`, `GET /audit`. Roles: viewer reads; support also edits clients and sites; admin also issues licences and agent tokens, manages releases and staff, and reads the audit.

## Backup keys (escrow)

`POST /sites/:id/backup-key` (admin) makes a site's backup key, returns it **once** for the installer, and stores it only sealed to `ESCROW_PUBLIC_KEY`. Make that key with `npm run cli -- escrow-keygen`: the private key is split into two shares for two custodians; neither alone can open anything. `escrow-open <sealed> <shareA> <shareB>` is for a recovery ceremony. A new key (rotation) starts a new backup set.

## Staff two-step sign-in and support sessions

TOTP with recovery codes; in production staff must set it up before doing anything else (`REQUIRE_STAFF_MFA`, `DATA_ENCRYPTION_KEY`). Approved remote support: staff request a session, the site shows its customer a code, staff enter it, only the site's agent can approve it.

## Known gaps (planned)

- Rate limiting, TLS, and running behind the gateway are deployment work (phase 0).
- Release manifests list image digests; building and pushing the images is the release pipeline's job.

## Tests

`npm test` needs PostgreSQL (default `postgres://postgres@localhost:5434/postgres`, or `TEST_PG_ADMIN_URL`); each run uses a throwaway database. `test/licence-vector.json` is shared with the product server's tests so both sides agree on how a licence is signed.
