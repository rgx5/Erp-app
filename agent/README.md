# OneSyncERP fleet agent

Runs on every site server. It only ever makes **outbound** requests to the control plane (`../control-plane`); nothing connects in.

| Duty | How |
|---|---|
| **Heartbeat** (every minute) | reports version, database health, disk, backup and log-shipping status (files written by the backup shipper), tunnel state, and the outcome of the last upgrade |
| **Signed updates** (every 5 minutes) | asks for the newest release open to this site's ring; **verifies the Ed25519 signature** with the control plane's release public key; applies it only inside the site's **maintenance window** |
| **Safe upgrade** | check disk → **back up** → pull images → **migrate** (all-or-nothing) → switch → health check. A bad release is rolled back (database changes only add, so the previous version still runs); if even that is unhealthy, the pre-upgrade backup is restored. Every outcome shows on the fleet screen |
| **Licence sync** | fetches the site's signed licence and hands it to the product server (which verifies it itself) |
| **Approved support** | staff request a session; the site shows its customer a six-digit code; staff enter what the customer reads out; only then does the agent let the staff member's SSH key in, until the time is up. Three wrong codes refuse the session. The code never goes to the control plane |

## Backups (sprint 5)

`src/backup/` and `src/backup-cli.ts` (installed as `onesync-backup` / `onesync-restore`) run **pgBackRest**:

- **Encrypted on the site** (AES-256, one key per client) into every repository: the cloud S3 store, a second provider, and a local disk. The repositories only ever hold ciphertext.
- **Continuous**: PostgreSQL ships every finished log segment and is forced to finish one at least every minute (`archive_timeout=60`), so work is recoverable to within about a minute while the site has internet. Nightly incremental and weekly full backups run from systemd timers; a status file is refreshed every minute and reported in the heartbeat.
- **The site cannot erase its history**: it runs with `expire-auto=n` and its store credentials cannot delete (`deploy/cloud/`); retention runs from the cloud side.
- **Restore** (`onesync-restore [label] [--time T]`): stops the application, restores over the database, waits for recovery, starts the application, checks it; the application stays stopped if anything fails.
- **Restore tests** (`backup-cli restore-test`): restore into a scratch database with archiving off, run checks (it opens; the ledger balances), clean up.
- **Verification**: `backup verify` reads each repository's report, because pgBackRest prints damage but still exits 0.

`test/backup.e2e.test.ts` runs all of this against a **real PostgreSQL 16 and real pgBackRest** (needs root, `pgbackrest`, PostgreSQL 16 binaries; skipped otherwise): encrypted backup into two repositories (no plaintext in the repository files), log shipping and status, a point-in-time restore test that leaves the live database untouched, rebuilding a destroyed server including work that existed only in the shipped log, and detecting a damaged repository.

## Layout

- `src/upgrade.ts`: the upgrade procedure, against a `UpgradePorts` interface (tested with a failure injected at every step).
- `src/system.ts`: the real machine (Docker, backup scripts, status files, SSH keys).
- `src/agent.ts`, `src/main.ts`: the duties and the loop.
- `deploy/`: `docker-compose.site.yml`, `Caddyfile` (HTTPS on the office network), `onesync-agent.service`, `install.sh`.

## Tests

`npm test`. `test/e2e.test.ts` runs the **real control plane** (in process, real database and port) against the real agent logic, so signing, licences, releases, health and support are checked across the boundary; only the machine is faked. It needs the control plane's dependencies (`cd ../control-plane && npm ci`) and PostgreSQL.

## What still needs a real server

`install.sh` and the Docker/backup/SSH ports in `src/system.ts` have been syntax-checked and the compose file validated, but never run on a clean Ubuntu machine (this environment has no Docker daemon). Run them on a test machine before any client. The Docker side of the backup commands (`src/backup/docker.ts`, the postgres image, the compose changes, the systemd timers) is likewise untested on a real site; the backup logic itself is tested against a real database (above). Not included here, by design: the tunnel client. The agent calls the backup commands named in `BACKUP_COMMAND` / `RESTORE_COMMAND` and refuses to upgrade without a working backup.
