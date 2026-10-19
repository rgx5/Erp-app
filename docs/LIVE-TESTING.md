# Live testing against a real server

`npm test` is hermetic: the sync engine is exercised against an in-memory fake. Two extra suites run the app's real code
against a real Krishna Collection backend and PostgreSQL. They are skipped unless the environment variables below are set.

| Suite | Needs | Proves |
| --- | --- | --- |
| `src/data/__tests__/live.test.ts` | a provisioned store (seeded data is a bonus) | sign-in, hydration, every kind of write, server books == phone's, 409 handling, cashier role, bare-address URLs |
| `src/data/__tests__/live-replay.test.ts` | an **empty** provisioned store + `KOSH_LIVE_PACK` | a whole generated business for one industry uploads cleanly and the books agree |

## 1. A throwaway PostgreSQL

Any PostgreSQL ≥ 14 works. For example with the server binaries (never as root):

```bash
initdb -D /tmp/pgdata -A trust -U postgres
pg_ctl -D /tmp/pgdata -o "-p 5433" -l /tmp/pg.log start
createdb -h localhost -p 5433 -U postgres rr_live
```

## 2. The Krishna backend

From a checkout of `krishna-collection-billing/backend` (copy it somewhere if you do not want to touch the original):

```bash
npm install && npm run build
export DATABASE_URL=postgresql://postgres@localhost:5433/rr_live JWT_SECRET=$(openssl rand -hex 32)
node dist/cli/migrate.js
node dist/cli/provision.js --store "Live Test" --owner "Asha" --email asha@live.test --password live-password-1 --pin 1111 --store-id store_live
npx ts-node src/cli/seed-demo.ts --store-id store_live --days 30     # optional: realistic data to hydrate
PORT=8081 node dist/main.js &
```

## 3. Run the suites

```bash
export KOSH_LIVE_API=http://localhost:8081/api
KOSH_LIVE_EMAIL=asha@live.test KOSH_LIVE_PASSWORD=live-password-1 npx jest live.test

# one empty store per industry (provision each with a new --store-id and --email), then:
KOSH_LIVE_PACK=grocery KOSH_LIVE_EMAIL=… KOSH_LIVE_PASSWORD=… npx jest live-replay
```

`live.test.ts` can be re-run against the same database (every record it creates is uniquely named). The replay needs a fresh
empty store each time, because it asserts the store starts empty.

## What these runs found

* The server rejects empty `size` / `color` — handled in `src/data/wire.ts` and covered by unit tests.
* The address people type has no `/api` — the app now adds it.
* Three server behaviours worth fixing, listed in [API-CONTRACT.md](./API-CONTRACT.md#known-gaps-in-the-server-found-by-running-against-it).
