# Kosh ERP

A mobile ERP for **Android and iOS** that runs a small business end to end — billing, stock, purchases, customers,
expenses, cash drawer and reports — and adapts its vocabulary, tax defaults and starting catalogue to the trade:
clothing, grocery, pharmacy, electronics, restaurant, salon, hardware or any general store.

It is built on what the Krishna Collection billing software proved in a real clothing store (GST maths, returns,
loyalty, offline-first sync, multi-device numbering), re-imagined as a phone-native app with its own design language.
It connects to the same cloud API, so clients who already run that product can open their business on a phone, and it
also works **fully offline on its own**.

> "Kosh" (कोश, *treasury*) is a working name — rename it in `app.json` and `src/features/Logo.tsx`.

## What's in it

| | |
| --- | --- |
| **Sell** | Scan or search, fractional quantities (kg, m, l), item and bill discounts, coupons, loyalty points, store credit, split payments (cash / UPI / card / credit), parked bills, price-later items, GST invoices and 58/80 mm receipts (print, PDF, WhatsApp) |
| **Bills & returns** | Full history, partial returns with exact tax/discount reversal, credit notes, store-credit refunds |
| **Items** | Variants with their own barcode and stock, category-driven rules (unit, HSN, GST, tracking), bulk pricing, barcode label printing, archive/delete |
| **Stock** | On-hand with low/out filters, adjustments with reasons, ledger, restock suggestions, scan-based physical count |
| **Purchases** | Goods-received notes with invoice-total check, weighted-average costing, supplier dues, price-later queue |
| **People** | Customers (loyalty, credit, birthdays, history), suppliers, staff with Owner / Manager / Cashier roles and PIN login |
| **Money** | Expenses by category, cash-drawer open/close with variance (Z-report) |
| **Reports** | Sales, GST/HSN, profit, items, staff — with CSV export |
| **Industries** | Eight packs, each with its own vocabulary, tax slabs, categories, reasons and a realistic generated demo business |
| **Sync** | Offline-first outbox → ordered upload, conflict-safe, multi-device invoice series, token refresh, set-aside for rejected records |
| **Security** | Biometric app lock, secure-store tokens, salted PIN hashes with escalating lockout, server-enforced roles |

Details: [Architecture](docs/ARCHITECTURE.md) · [Cloud API contract](docs/API-CONTRACT.md) ·
[Industry packs](docs/INDUSTRIES.md) · [Design language](docs/DESIGN.md) · [Roadmap](docs/ROADMAP.md).

## Run it

```bash
npm install
npx expo start            # scan the QR code with Expo Go (iOS / Android), or press a / i / w
```

The first launch offers three doors: **connect** a business on a server, **explore a demo** (pick an industry — a
believable 45-day business is generated on the phone), or **start fresh** offline.

Optional: copy `.env.example` to `.env` and set `EXPO_PUBLIC_DEFAULT_API_URL` to pre-fill the server address.

### Scripts

| | |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Jest — domain parity, ops, store, sync engine, demo invariants |
| `npm run lint` | `expo lint` |
| `npm run bundle:check` | Compile the Android and iOS bundles (catches anything Metro can't resolve) |

## Build installable apps

Builds use [EAS Build](https://docs.expo.dev/build/introduction/); profiles are in `eas.json`.

```bash
npm i -g eas-cli && eas login
eas build:configure                        # once: links the project to your Expo account
eas build -p android --profile preview     # an installable APK for testing
eas build -p ios     --profile preview     # needs an Apple developer account
eas build --profile production             # Play Store AAB / App Store build
```

Set the app name, `com.kosh.erp` bundle id / package and icons in `app.json` and `assets/` to your own before
publishing.

## Project layout

```
src/
  app/          Expo Router screens (tabs, sell, bills, items, stock, purchases, customers, expenses, settings…)
  ui/           Kosh design system: theme, text, buttons, inputs, sheets, charts, icons
  features/     Reusable flows: pickers, line editor, PIN pad, scanner bus, print/share
  data/         Store, ops (business actions), storage, sync engine, demo generator, auth
  domain/       Pure business logic: money, GST, cart, returns, analytics, receipts  (+ tests)
  industries/   Industry packs (data, not code)
docs/           Architecture, API contract, industries, design, roadmap
scripts/        gen-golden.ts — regenerates the parity fixtures from the reference implementation
```

## Verification status

Automated (all green on the final commit): strict `tsc`, ESLint, **2,326 Jest tests** — including byte-for-byte parity of
the money / GST / return / report maths with the reference implementation, a fake-server sync suite, and invariants over a
generated business for every industry — and compiled Android and iOS Hermes bundles.

Run against the **real Krishna backend** (NestJS + PostgreSQL): the app signs in, downloads a seeded store, uploads every kind of
write, and a replay of a full 30-day business for each of the eight industries (~8,000 writes, ~6,500 bills) is accepted with the
server's stock, prices, bills, purchases, expenses, drawer sessions and customer balances matching the phone's. This found and
fixed two real mismatches (variants with no size/colour were refused; the server address needs `/api`) and surfaced three server quirks, listed in [docs/API-CONTRACT.md](docs/API-CONTRACT.md).

Exercised by hand in a Chromium build of the same code, in light and dark mode and across all eight industry demos:
receiving stock, creating an item with variants, recording an expense, adding a customer, closing the cash drawer,
switching industry, and every screen reachable from the tabs.

**Not covered here** — do these before a client rollout:

* a run on a physical Android/iOS device or emulator (camera barcode scanning, biometrics, on-device SQLite, printing);
* a live test against *your* deployed Krishna server (it has been run against the real Krishna backend on a local PostgreSQL —
  see [docs/LIVE-TESTING.md](docs/LIVE-TESTING.md) — but not against a hosted one);
* store builds — EAS Build needs your Expo and Apple/Google accounts.
