# Releasing and running the desktop app

## What is built

`desktop-client` is an Electron app (installer per operating system) and the same web build runs in a browser. It needs a running OneSyncERP server; it stores nothing business-critical locally except an optional queue of offline counter sales and a saved item catalogue.

| Command | Result |
|---|---|
| `npm run build` | Compiles main, preload and renderer into `out/`. |
| `npm run dist` | Builds and packages with electron-builder into `release/` (Windows NSIS, macOS dmg, Linux AppImage and deb, per the host OS). |
| `.github/workflows/desktop-client.yml` | Runs lint, typecheck, unit, live-backend, browser and Electron tests on every change. |

## Signing and updates: not yet done, needs decisions

| Item | State | What is needed |
|---|---|---|
| Windows code signing | Not done. Unsigned installers show a SmartScreen warning. | A code-signing certificate (EV recommended); set `CSC_LINK` and `CSC_KEY_PASSWORD` in CI. |
| macOS signing and notarisation | Not done. | An Apple Developer ID and notarisation credentials. |
| Auto-update | Not done. | A place to host release files (for example object storage or GitHub Releases), then `electron-updater` with a `publish` target in the builder config and a signed build (updates are refused when unsigned on macOS and are a risk on Windows). |
| Installer CI | The workflow has not run on a hosted runner yet; the Windows installer build and the artifact upload are untested. | Run the workflow once and fix what it finds. |

Until these exist, distribute installers only to people you trust and tell them to expect the unsigned-app warning.

## Backups: the data lives on the server

The app holds no books. What must be backed up is the PostgreSQL database behind the server.

1. **Continuous archiving (WAL) plus a nightly base backup**, or a managed database with point-in-time recovery. Write down how much loss you can accept (RPO) and how long recovery may take (RTO).
2. **Test a restore** into a scratch database on a schedule and open the restored copy with the app: sign in, run the trial balance, check it balances and totals match the last known figures. A backup nobody has restored is a hope, not a backup.
3. Keep copies **off the server's own disk and account**.
4. Keep the server's secret configuration (token signing key, encryption keys) backed up **separately** from the database: the database is useless without the keys that unlock secrets stored in it.
5. The audit log is part of the database and is covered by the same backups; nothing in the app can remove entries.

## Upgrading

1. Back up the database.
2. Deploy the new server first (it applies migrations; they are forward-only and run as a separate privileged role).
3. Then roll the desktop app. The app checks the server's API version on connect (`/v1/meta`) and shows a clear message when they differ; the API only adds fields within `v1`.

## Support checklist

- The reference shown with an error message finds the request in the server log and the audit log.
- *Administration, Audit log* shows who did what and when; entries can be exported to CSV.
- Counter trouble: *Counter* shows the offline queue; *Shifts and setup* shows each shift's totals and cash-up difference.
