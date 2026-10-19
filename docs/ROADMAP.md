# Roadmap

What exists today is a complete retail ERP for phones. What follows is honest about what is *not* there, ordered by how
many clients it unblocks.

## Near term — the gaps each industry pack already admits to

| Feature | Unblocks | Notes |
| --- | --- | --- |
| **Batch & expiry** on stock | Pharmacy, grocery | Receive by batch, sell first-expiring-first, "expiring in 30 days" report. Needs `batch` rows on variants and a server column. |
| **IMEI / serial numbers** | Electronics | Unit-level stock and warranty look-up by serial. |
| **Tables & kitchen tickets (KOT)** | Restaurant | Open tabs per table, split bills, KOT print, optional recipe-wise stock. |
| **Appointments & commissions** | Salon | Calendar, stylist availability, commission payouts from per-line staff attribution (already recorded). |
| **Receivables (udhaar) ledger** | All wholesale / kirana | Sell on credit, part-payments, ageing, reminders over WhatsApp. `PayMode` already includes `credit`. |
| **Bluetooth thermal printing** | All | Today: system print dialog / PDF / WhatsApp. ESC/POS over BLE needs a native module (EAS dev build). |

## Platform

* **Delta sync + device registry** on the server (see [API-CONTRACT.md](./API-CONTRACT.md#recommended-server-improvements-not-required)).
* **Background sync** (`expo-background-task`) so a closed app still uploads a day's bills.
* **Push notifications**: low stock, day-close reminder, "bills waiting to sync".
* **IGST / inter-state** invoices and e-invoice (IRN) / e-way bill export.
* **Multi-store** switcher for owners with several outlets, with consolidated reports.
* **Tablet layout**: two-pane POS and master/detail lists (iPad `supportsTablet` is already on).
* **Localisation**: Hindi and regional languages; the label system already centralises vocabulary.
* **Crash & performance telemetry** (opt-in), and a Detox/Maestro end-to-end suite on EAS.
* **Biometric step-up** for sensitive actions (large discounts, deleting bills, data export).

## Deliberately out of scope for now

Full accounting (ledgers, balance sheet), payroll, manufacturing/BOM, and online-store sync. Kosh exports clean CSVs
(sales, GST, profit, items, staff) so a client's accountant can take it from there.
