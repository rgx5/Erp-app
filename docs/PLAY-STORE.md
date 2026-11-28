# Publishing the Android app on Google Play

The app: package **`com.onesync.erp.mobile`**. It is the full OneSyncERP client in a phone layout, online only, wrapped for Android with Capacitor 8 (target API 36, minimum Android 7 / API 24).

> **The package name is permanent.** Once the app is created in Play Console it can never be changed. If you want a different one (for example `com.onesyncerp.app`), change `appId` in `desktop-client/capacitor.config.ts` and `packageName` in `.github/workflows/android-release.yml` *before* the first upload.

## What is already done in the repository

| | |
|---|---|
| Target API 36 (Play's requirement for new apps and updates from 31 Aug 2026) | Capacitor 8; the release workflow refuses to build below 36 |
| Signed **App Bundle (.aab)** | `.github/workflows/android-release.yml` |
| Release signing only with your key; refuses to run without it | secrets listed below |
| https only, web debugging off, Android backup off | store builds never use the test settings |
| Versioning | `versionCode` rises with every run; `versionName` is what you type |
| Privacy policy text, store listing text, data safety answers | this file and `docs/PRIVACY-POLICY.md` |
| Icon 512×512, feature graphic 1024×500, 8 phone screenshots 1080×1920 | `store/android/` (regenerate: `npx tsx scripts/play-store-assets.mts` in `desktop-client/`) |
| In-app links to privacy policy and terms (sign-in screen and account menu) | uses https://onesyncerp.com/privacy and /terms |
| Phone layout of the invoice screen, tested on a 360 px screen | `tests/e2e/phone.spec.ts` |

## What only you can do

1. **Google Play developer account** (one-off US$25, identity verification; an *organisation* account needs a D-U-N-S number). Personal accounts created after Nov 2023 must run a **closed test with at least 12 testers for 14 days** before they may publish to production; organisation accounts do not.
2. **Upload key.** On your own computer run `bash scripts/android-upload-key.sh`, then add the four secrets it prints at GitHub → Settings → Secrets → Actions. Keep the `.jks` and its password in a password manager, not in the repository. Use **Play App Signing** (the default) so Google holds the real signing key and a lost upload key can be reset.
3. **Publish the web pages** https://onesyncerp.com/privacy (from `docs/PRIVACY-POLICY.md`, after legal review) and https://onesyncerp.com/terms. The app links to both and Play requires a working privacy policy URL.
4. **A demo server for Google's reviewers.** The app is useless without a server address and a login, and the review team must be able to sign in. Stand up a public demo (for example `https://demo.onesyncerp.com`, seeded with `scripts/marketing-capture.mts`-style data) and put its address, business code, email and password in *App content → App access*. Without this the app is rejected.
5. **Decide the package name** (see above), then create the app in Play Console.
6. Fill in the Play Console forms with the answers below.

## Releasing

1. GitHub → Actions → **Android release (Play Store)** → *Run workflow*: enter the version (for example `1.0.0`) and, if you added the `PLAY_SERVICE_ACCOUNT_JSON` secret, a track (`internal` first). Otherwise choose `none` and download the `.aab` from the run's artifacts and upload it in Play Console → Testing → Internal testing.
2. Install from the internal-test link on a real phone and go through sign-in, an invoice and a report.
3. Promote to closed → production. Keep release notes short and plain.

`PLAY_SERVICE_ACCOUNT_JSON`: Play Console → Setup → API access → create a service account, grant it *Release manager* on this app, create a JSON key and paste the whole file as the secret.

## Store listing text

**App name** (30): `OneSyncERP: Billing & GST`

**Short description** (80): `Invoices, GST, stock, payments and reports from your own OneSyncERP server.`

**Full description** (4000):

> OneSyncERP is complete business software for Indian traders, shops, distributors and manufacturers. This app is your phone's window onto your own OneSyncERP server: everything you can do on the desktop, in a layout made for a phone.
>
> • Sales: GST tax invoices, bills of supply, quotations, orders, credit and debit notes, e-invoice and e-way bill files, TCS, export invoices in foreign currency
> • Collections: receipts, cheque tracking, customer statements, ageing, payment reminders by WhatsApp
> • Purchases: supplier bills, payments, TDS, landed cost
> • Stock: items with batches, serial numbers and variants, warehouses, low-stock alerts
> • Accounts: ledger, trial balance, profit and loss, balance sheet, bank reconciliation, loans
> • GST: GSTR-1 and 3B working, GSTR-2B reconciliation
> • Reports and a live dashboard of cash, revenue, profit and what customers owe
> • Hindi, Marathi and Gujarati
>
> The app needs an internet connection and a OneSyncERP server (run by your business or hosted for you). Sign in with the business code, email and password your administrator gave you. It does not show ads and collects nothing about you.
>
> Don't have a server yet? Visit onesyncerp.com.

**Category:** Business. **Tags:** accounting, invoicing, inventory. **Contact:** support email, website https://onesyncerp.com, phone optional. **Privacy policy:** https://onesyncerp.com/privacy.

## Play Console answers

* **App access:** *All or some functionality is restricted* → provide the demo server address, business code, email, password and a line: "Enter the server address on the first screen, then the business code, email and password."
* **Ads:** No.
* **Target audience:** 18 and over only. Not designed for children.
* **Content rating (IARC questionnaire):** category *Utility / productivity*; no violence, sexual content, language, gambling, controlled substances or user-to-user content → expected *Everyone*.
* **Data safety:** *Does the app collect or share user data?* **No data is collected by the developer.** The app only sends what the user types to the server address the user chose (their own business's server), which is not collected by us; sessions are kept in private app storage. If you host client servers yourself and want to be conservative, declare *Personal info (name, email) and Financial info* as **collected, not shared, encrypted in transit, required for app functionality, deletion on request**; both are acceptable, but the declaration must match the privacy policy.
  * Data encrypted in transit: Yes (https only). Users can request deletion: Yes (via their administrator; see policy).
* **Account deletion:** the app has no self-service sign-up (administrators create users), so the in-app/web deletion URL requirement applies to the *business account*; give https://onesyncerp.com/privacy#keeping-and-deleting-data and the support email.
* **Government apps / financial features:** not a government app. It records invoices and accounts but does not move money, lend or offer financial products: answer *No* to loan, payments and crypto features.
* **Permissions:** INTERNET only (and ACCESS_NETWORK_STATE from Capacitor). Nothing sensitive to justify.
* **News / COVID / health:** No.
* **Advertising ID:** not used (declare *No*).

## Checks before each release

* The `Android release` run is green and prints `target SDK 36`.
* Install the `.aab`-derived APK from the run on a phone: sign in, raise an invoice, open a report, rotate the screen, sign out.
* The privacy policy page is live and matches `docs/PRIVACY-POLICY.md`.
* Pre-launch report in Play Console shows no crashes.

## Known limits

* Online only. Printing from the phone, camera barcode scanning and the point-of-sale counter on very small screens are not done.
* The app talks to servers over https only. A business whose server is on a plain-http office network cannot use the store build; give it the private "Mobile app (Android)" test build instead (`mobile-apk.yml`), which is never uploaded to Play, or put the server behind https.
* Wide report tables scroll sideways inside their box on a phone.
