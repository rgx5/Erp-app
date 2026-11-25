# OneSyncERP mobile app (Android)

The phone app is the Expo / React Native app in the repository root (`src/`). It talks **only to the OneSyncERP platform** (the NestJS
backend in `backend/`). It keeps the business on the phone (SQLite) so counter work carries on without a connection, and uploads in order
when the connection returns.

## How it connects

`src/data/platform/` translates between the phone's model (products with variants, customers, bills) and the platform's (items, parties,
tax invoices):

| Phone | Platform |
| --- | --- |
| Sign in: server address, **business code**, email, password | `POST /v1/auth/login` (tenant, email, password); access token renewed with the refresh token |
| Download: items, stock, prices, customers, suppliers, recent sales, expenses | `/v1/items`, `/v1/stock/balances`, `/v1/parties`, `/v1/pos/sales`, `/v1/expenses/vouchers`, till catalogue |
| Counter sale | `POST /v1/pos/sales` (idempotent on the bill id; the platform's total wins when rounding differs) |
| Sales return | `POST /v1/pos/returns` against the original sale's lines |
| Customer / supplier added or edited | `POST` / `PATCH /v1/parties` |
| Item added, price or name changed | `POST` / `PATCH /v1/items` (one platform item per variant) |
| Stock adjustment, opening stock | `POST /v1/stock/movements` (adjustment) |
| Goods received | goods receipt + supplier bill + payment (`/v1/purchasing/...`) |
| Expense | `POST /v1/expenses/vouchers` (category created on first use) |

On first sign-in the phone finds the company, registers itself as a till device (a "Phone" terminal if the business has none) and opens a
shift when a sale needs one. The business must have a **payment account mapped for each payment method** (cash, UPI, card…) in POS setup, or
sales paid that way are refused (the phone says so).

Not synced yet (the phone keeps them locally and the change is set aside with a clear reason): coupons, staff accounts, store settings,
price lists, credit (due) sales.

## Build

`npm ci && npm test && npm run typecheck`. The **Android APK** workflow builds one APK per CPU type on every push to a `ccr-*` branch
or `main`, and publishes them to the `apk-latest` pre-release. It signs with a release key when these repository secrets exist, otherwise
with the debug key (installs for testing):

* `ANDROID_KEYSTORE_BASE64` — the `.jks` file, base64
* `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`

Create the key once: `keytool -genkeypair -v -keystore release.jks -alias onesync -keyalg RSA -keysize 2048 -validity 10000`. **Keep it safe**:
an app update must be signed with the same key as the first install. For the Play Store build an `.aab` (`./gradlew bundleRelease`) with the same key.

## Checking against a real backend

`desktop-client/tests/platform-live.mts` boots a real backend and walks the whole adapter: sign-in, download, sales (incl. a retried one
and a rounding difference), returns, expenses, customers, items, stock, purchases, and an expired login.
Run it from `desktop-client/`: `npx tsx --tsconfig ../tsconfig.json tests/platform-live.mts`.
