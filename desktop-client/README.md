# OneSyncERP desktop client

The Windows / macOS / Linux client for the OneSyncERP backend in `../backend`. Electron shell + React 19 + TypeScript + Vite, with TanStack Router, Query and Table, Tailwind. See `../docs/DESKTOP-CLIENT-PLAN.md` for the plan and slices.

```bash
npm install
npm run dev            # the desktop window (electron-vite, hot reload)
npm run web            # the same UI in a browser at http://localhost:5173 (no keychain, settings in localStorage)
npm run build          # compile main, preload and renderer into out/
npm run dist           # build an installer for this OS into release/
```

The server must list this app's origin in `CORS_ALLOWED_ORIGINS` (the shell uses `app://onesync`; the browser dev server uses `http://localhost:5173`).

## Layout

| Path | What |
|---|---|
| `electron/main` | window, fixed `app://onesync` origin, settings file, OS-keychain secrets, IPC guarded by sender origin |
| `electron/preload` | the one narrow bridge (`window.onesync`: info, settings, secure); context isolation on, sandbox on, Node off |
| `src/api` | generated types (`schema.d.ts`, from `../backend/docs/openapi.json`), the client (token refresh, idempotency keys, problem+json), zod response schemas |
| `src/domain` | exact money (decimal strings, never floats) and Indian number/date formats |
| `src/auth` | session store (connect, sign in, silent refresh, restore), permission checks |
| `src/features/*` | one folder per backend domain (today: auth, dashboard, organization, setup, masterdata, sales, purchasing, approvals, inventory, accounting) |
| `src/ui` | design-system pieces: shell, primitives, virtualised `DataTable` |

## Rules

- The client never computes anything the server stores (tax, totals, numbers, balances); it shows what the server returns.
- Amounts are decimal strings end to end.
- Every write carries an `Idempotency-Key` (kept across the silent token-refresh retry).
- `npm run api:gen` regenerates `src/api/schema.d.ts`; CI fails when it drifts (`api:check`).
- The server's OpenAPI describes request bodies and path parameters (no query parameters or responses yet, backend gap G8), so responses are validated by zod schemas in `src/api/schemas.ts` and query parameters go through `query()`.

## Tests

| Command | What |
|---|---|
| `npm test` | unit tests (money, formats, API client, permissions, app:// file serving) |
| `npm run test:live` | the client against a real backend and PostgreSQL (needs `../backend/scripts/pg-local.sh` or `TEST_PG_ADMIN_URL`) |
| `npm run test:e2e` | Playwright in Chromium: connect, sign in, dashboard, companies, sign out; the full first-run setup of a new business; master data (items with CSV import/export, customers with addresses, tax rates, price lists); sales (invoice with live totals, credit note, receipt, receivables, cancel); purchasing (order, receive, bill with preview and price exception, payment, payables); approvals across two users; inventory (adjust, transfer, count, valuation); accounting (manual journal and reversal, reports, periods, bank statement import and reconciliation) |
| `npm run test:e2e:desktop` | the built Electron app (use `xvfb-run -a` on a headless Linux box): fixed origin, settings that survive a restart, sign-in to the real backend from `app://onesync`, an invoice saved as an A4 PDF |
