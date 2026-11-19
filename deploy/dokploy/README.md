# Deploying OneSyncERP's cloud side with Dokploy

Two Dokploy **Compose** services from this repository, on your Hostinger VPS (Mumbai):

| Service | Compose file | What it runs | Public address (you choose) |
|---|---|---|---|
| **onesync-cloud** | `deploy/dokploy/docker-compose.cloud.yml` | the control plane (staff dashboard + its database) and the remote-access gateway | `control.yourdomain.in` → `control-plane:8090`; `gateway.yourdomain.in` and one `<client>.remote.yourdomain.in` per client → `gateway:8443` |
| **onesync-cell-…** (optional, one per pooled/dedicated cell) | `deploy/dokploy/docker-compose.cell.yml` | the product API + its database + a small filter, for clients hosted by you | `app.yourdomain.in` → `edge:8080` |

On-premises clients do **not** run on Dokploy: they run the installer in `agent/deploy` on their own server and call out to `gateway.yourdomain.in` and `control.yourdomain.in`.

Nothing in these files publishes a host port. Dokploy's Traefik terminates TLS and reaches the services over `dokploy-network`.

## 0. Before you start

- A VPS with Dokploy installed: **2 vCPU / 4 GB RAM** is enough for the cloud service plus one small cell; give each extra cell about 1 vCPU / 2 GB.
- Firewall: open only 22 (your IP), 80 and 443. Put the Dokploy panel behind its own domain with HTTPS (or restrict port 3000 to your IP).
- DNS `A` records pointing at the VPS: `control`, `gateway`, `app` (if you host a cell), and one `<client>.remote` per Hybrid client (add them as you onboard).
- The repository connected in Dokploy (GitHub app). Deploy from the branch you trust: today the work is on `ccr-8ac47726-gfjbpv`; merge it to your main branch first if you want auto-deploys from main.

## 1. The cloud service (control plane + gateway)

1. On your own machine: `deploy/dokploy/gen-secrets.sh cloud` and keep the output (it is not stored anywhere). Back the keys up in your password manager: **if the licence or release private key is lost, no client can receive a new licence or upgrade.**
2. Dokploy → **Create Service → Compose**, source **Git**, repository + branch, compose path `deploy/dokploy/docker-compose.cloud.yml`.
3. **Environment** tab: paste the `cloud` output (`CP_DB_PASSWORD`, `LICENCE_PRIVATE_KEY`, `RELEASE_PRIVATE_KEY`, `DATA_ENCRYPTION_KEY`, `GATEWAY_TOKEN`, `REQUIRE_STAFF_MFA`). Keys can stay on one line with `\n` for the line breaks.
4. **Domains** tab (Dokploy writes the Traefik rules; HTTPS on, certificate "letsencrypt"):
   - `control.yourdomain.in` → service `control-plane`, port `8090`
   - `gateway.yourdomain.in` → service `gateway`, port `8443`
   - for each Hybrid client, add `<client>.remote.yourdomain.in` → service `gateway`, port `8443` (this is the address its remote users open, and the one you type into the cell's page in the super admin dashboard)
5. **Deploy**. The control plane creates its own tables on start. Check `https://control.yourdomain.in/health` shows `{"ok":true}`.
6. Create the first admin. **Without a terminal:** set `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (12+ characters) in the Environment tab and deploy: on start-up the control plane creates that admin if it has no staff yet, and the log says so. Sign in at `https://control.yourdomain.in/ui`, then delete the two settings (they do nothing once any staff exists, but the password should not stay in a settings page). **Or with the Terminal** (Dokploy → service → Terminal → container `control-plane`):
   ```
   CP_PASSWORD='a-long-password-of-12-or-more-characters' node --import tsx src/cli.ts create-staff you@yourdomain.in "Your Name" admin
   ```
   (`DATABASE_URL` is already set inside the container.) You will be asked to set up two-step sign-in before anything else, unless `REQUIRE_STAFF_MFA=false`.
7. Make the **escrow key** once (Terminal, same container: `node --import tsx src/cli.ts escrow-keygen`). Put the public key in `ESCROW_PUBLIC_KEY` in the Environment tab and redeploy. The two private shares go to two different people, stored offline.

**Demo data for the control panel** (demo servers only). **Without a terminal:** set `DEMO_SEED_ENABLED=true`, redeploy, sign in as an admin, and press **Fill with demo data** on the empty Overview (or `curl -X POST https://control.yourdomain.in/demo/seed -H "Authorization: Bearer <session token>"`). **Or with the Terminal**, run
```
CP_EMAIL=you@yourdomain.in CP_PASSWORD='your password' node scripts/seed-demo.mjs
```
It creates 8 clients across the four editions with their cells (on-premises, dedicated, one shared cloud cell), remote addresses and rules, licences, reported businesses with usage, validation results, three releases rolling out, and a few things needing attention (a nearly full disk, a cell that never reported, a business at its user limit, an expiring licence, a failed check, a suspended business). Set `REMOTE_DOMAIN=remote.yourdomain.in` to put your own domain on the remote addresses. Running it again duplicates nothing; it refreshes every cell's "last seen" time. Demo cells go silent about 10 minutes after the last run because no real agent reports for them: run it again before showing the dashboard, or add `KEEP_ALIVE=1` to leave it running and report every minute.

**Wildcard addresses.** Dokploy's default certificates use the HTTP challenge, which cannot issue `*.remote.yourdomain.in`; that is why each client's address is added as its own domain. If you want a wildcard, switch Traefik to a DNS challenge (Cloudflare or your DNS host) in Dokploy's Traefik settings; then one wildcard domain on `gateway:8443` is enough.

**WebSockets** (the site tunnels use them) work through Traefik with no extra settings. The gateway reads the visitor's address from Traefik's forwarded header, which is what the "allowed networks" rule uses.

## 2. Onboarding a client (from the dashboard)

1. Create the client (tier Local / Cloud / Hybrid / Hybrid Plus) and its cell (on-premises, dedicated or pooled), and issue the cell's **agent token** (shown once), with the control plane's API: `POST /clients`, `POST /sites`, `POST /sites/{id}/agent-token` (the dashboard has no form for these yet; see `control-plane/README.md`).
2. Hybrid clients: on the cell's page in the super admin dashboard set the remote address (`<client>.remote.yourdomain.in`), switch remote access on, choose the rules.
3. On-premises: run the installer on the client's server (`agent/deploy/install.sh`) with the control-plane URL, the agent token, the release **public** key and `GATEWAY_URL=https://gateway.yourdomain.in`.
4. Issue the licence for each business on its tenant page.

## 3. A pooled cell on Dokploy (optional)

1. `deploy/dokploy/gen-secrets.sh cell`, plus `LICENCE_PUBLIC_KEY` from the `cloud` run.
2. Dokploy → **Create Service → Compose** with `deploy/dokploy/docker-compose.cell.yml`; paste the variables (see `cell.env.example`).
3. **Domains**: `app.yourdomain.in` → service **`edge`**, port `8080`. Never point a domain at `api`: the `edge` filter is what keeps the platform administration routes (`/v1/platform/*`) off the internet.
4. Deploy. The one-shot `migrate` service applies the database changes before the API starts, on every deploy.
5. Create a business (over SSH, on the VPS):
   ```
   curl -s http://127.0.0.1:8081/v1/platform/tenants -H "authorization: Bearer $PLATFORM_ADMIN_TOKEN" -H 'content-type: application/json' \
     -d '{"name":"Acme","slug":"acme","owner":{"email":"owner@acme.in","displayName":"Owner","password":"…"}}'
   ```
   Then register the cell in the dashboard (kind **pooled**) and set `SITE_ID` to its id.
6. **Demo data** (demo servers only): set `DEMO_SEED_ENABLED=true` in the cell's environment, redeploy, then call
   ```
   curl -X POST https://app.yourdomain.in/v1/demo/seed -H "Authorization: Bearer <PLATFORM_ADMIN_TOKEN>"
   ```
   It takes a few seconds and answers with the steps it did and the login: a business with code `demo` (owner `owner@demo.example.com`, password `demo-passphrase-2026`) with every module filled: items and stock, customers and suppliers, about 80 invoices with receipts, purchasing, quotes and orders, expenses, a bank statement to reconcile, a counter with an open shift, manufacturing, payroll, three more users (accounts@, sales@, counter@demo.example.com, same password) and an approval policy. Calling it again adds only what is still missing (a business seeded by an older version gets the new modules added). To pick another business code or login, send JSON: `{"slug":"acme","email":"o@acme.in","password":"a-long-password","name":"Acme"}`. Without `DEMO_SEED_ENABLED=true` the endpoint answers 404, and it always needs the platform token. Turn the flag off again when the demo is set up. The same seeder also runs in the `api` container's terminal: `node scripts/seed-demo.mjs`.
7. Clients' desktop apps: server address `https://app.yourdomain.in`; owners can open `https://app.yourdomain.in/owner` in a browser.

## Troubleshooting a cell that will not start

- **`api` never starts, `migrate` says `password authentication failed for user "erp_migrator"`**: the database's first-start script did not create its roles (fixed in the current code). The database folder now exists without them, and PostgreSQL only runs the script on an empty folder, so after updating you must delete the database volume once: Dokploy → the cell service → stop it → Volumes → delete `cell-pgdata` (or on the server `docker volume rm onesync-cell_cell-pgdata`), then deploy again. Demo data is lost with it; on a server with real data never delete the volume, ask first.
- **502 Bad Gateway on the cell's address**: nothing answers behind the domain. Check the cell's `api`, `edge` and `migrate` logs, and that the domain points to service `edge`, port `8080`.

## 4. Backups (do this before the first client)

- **Control plane database** (fleet state, sealed backup keys): Dokploy → the service's volume `cp-db-data` → **Volume Backups** to an S3 destination (a second provider, not Hostinger). Run a restore into a scratch service once to prove it.
- **Pooled cell database**: the `dump` service keeps a daily compressed dump (14 kept) in the `cell-dumps` volume. That protects against mistakes, not against losing the VPS: also back up the `cell-dumps` volume off the server, the same way. This stack does **not** run the continuous (point-in-time) backups that on-premises sites get from the agent; do not promise those RPO/RTO figures for pooled clients until that is added.

## 5. Updating

Push to the connected branch; enable **Auto Deploy** (webhook) on each Dokploy service, or press Deploy. Database changes apply on start (control plane) or by the `migrate` service (cells). Roll back with Dokploy's deployment history; database changes are forward-only, so take a backup first.

## What has and has not been tested

Tested here: the compose files parse and resolve with real-looking values (`docker compose config`); the control plane and gateway start with the same command and environment the images use (keys pasted as `\n` one-liners, production mode), apply their migrations, serve `/health`, accept the first admin and require two-step setup; the backend accepts the cell's environment, including empty optional values.

**Not tested**: building the images and running them under Docker (no Docker daemon was available where this was prepared), Traefik/Dokploy domain handling, certificate issuance, and the Caddy filter in `cell/Caddyfile`. Do a first deploy to a throwaway subdomain and run through sections 1–3 before pointing real clients at it.
