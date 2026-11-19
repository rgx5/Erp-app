# OneSyncERP fleet agent

Runs on every site server. It only ever makes **outbound** requests to the control plane (`../control-plane`); nothing connects in.

| Duty | How |
|---|---|
| **Heartbeat** (every minute) | reports version, database health, disk, backup and log-shipping status (files written by the backup shipper), tunnel state, and the outcome of the last upgrade |
| **Signed updates** (every 5 minutes) | asks for the newest release open to this site's ring; **verifies the Ed25519 signature** with the control plane's release public key; applies it only inside the site's **maintenance window** |
| **Safe upgrade** | check disk → **back up** → pull images → **migrate** (all-or-nothing) → switch → health check. A bad release is rolled back (database changes only add, so the previous version still runs); if even that is unhealthy, the pre-upgrade backup is restored. Every outcome shows on the fleet screen |
| **Licence sync** | fetches the site's signed licence and hands it to the product server (which verifies it itself) |
| **Approved support** | staff request a session; the site shows its customer a six-digit code; staff enter what the customer reads out; only then does the agent let the staff member's SSH key in, until the time is up. Three wrong codes refuse the session. The code never goes to the control plane |

## Layout

- `src/upgrade.ts`: the upgrade procedure, against a `UpgradePorts` interface (tested with a failure injected at every step).
- `src/system.ts`: the real machine (Docker, backup scripts, status files, SSH keys).
- `src/agent.ts`, `src/main.ts`: the duties and the loop.
- `deploy/`: `docker-compose.site.yml`, `Caddyfile` (HTTPS on the office network), `onesync-agent.service`, `install.sh`.

## Tests

`npm test`. `test/e2e.test.ts` runs the **real control plane** (in process, real database and port) against the real agent logic, so signing, licences, releases, health and support are checked across the boundary; only the machine is faked. It needs the control plane's dependencies (`cd ../control-plane && npm ci`) and PostgreSQL.

## What still needs a real server

`install.sh` and the Docker/backup/SSH ports in `src/system.ts` have been syntax-checked and the compose file validated, but never run on a clean Ubuntu machine (this environment has no Docker daemon). Run them on a test machine before any client. Not included here, by design (next sprints): `onesync-backup` / `onesync-restore` (encrypted backup shipping), and the tunnel client. The agent calls the backup commands named in `BACKUP_COMMAND` / `RESTORE_COMMAND` and will refuse to upgrade without a working backup.
