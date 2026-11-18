# OneSyncERP desktop: user guide

For the people who use the app every day. For setting up the server see `docs/SERVER.md`.

## First start

1. **Connect.** Enter your server's address once. The app remembers it.
2. **Sign in** with your business code, email and password. If two-step sign-in is on, also the 6-digit code from your authenticator app.
3. **Setup** (owner, once): *Setup* walks through the company, GST registration, place of business, warehouse and financial year, and loads the standard Indian chart of accounts, tax rates and units in one click.

Only the menu items your role allows are shown. If something you expect is missing, ask an owner to check your role under *Administration, Roles*.

## Daily work, by menu

| Menu | What you do there |
|---|---|
| Sales | Invoices with live tax totals, credit and debit notes, receipts against invoices, who owes you (receivables). |
| Purchasing | Purchase orders, goods receipts, supplier bills (with a price check before posting), payments, what you owe (payables), approvals. |
| Inventory | Stock on hand and stock card, adjustments, transfers, stock counts, valuation. |
| Accounting | Journal entries (never edited, only reversed), chart of accounts, financial reports, bank reconciliation, periods and year-end. |
| GST returns | GSTR-1, GSTR-3B, ITC register, CMP-08 for any month, with GSTN JSON downloads. Returns are prepared here; filing is done on the GST portal. |
| Manufacturing | Bills of material, work orders (issue, time, output, complete), job work, costing. |
| Payroll | People, salary structures, monthly inputs, runs, payslips, statutory dues. |
| Point of sale | The counter (scan and sell, returns, offline selling), shifts and cash-up, terminal setup. |
| Administration | Users, roles, API keys, audit log, your own account. |

## Rules the app keeps for you

- **Nothing posted is edited or deleted.** Correct a mistake by reversing it (journals), crediting it (invoices) or cancelling it where the screen offers that. The audit log keeps every change.
- **The server decides tax and totals.** What the screen shows while you type is the server's own calculation.
- **A period that is closed accepts no postings.** Reopen it (if you have the right) or post in the next one.
- **Large payments, purchase orders and journals may need approval.** The app asks for it and a second person approves under *Purchasing, Approvals*.

## Layout

*My account, Appearance* chooses between the **Sidebar** (a menu down the left) and the **Command centre** (a slim rail of areas, the pages of each area as tabs, and records that open beside the list). The choice is kept on this computer.

## Keyboard

| Key | Where | Does |
|---|---|---|
| Ctrl+S / Ctrl+Enter | Journal editor | Posts a balanced entry |
| F2 | Counter | Back to the scan box |
| F9 | Counter | Charge the sale |
| Ctrl+K | Anywhere | Search for a page, or start something new (new invoice, open the counter) |
| Up / Down, Enter | Any list | Moves along the rows and opens the highlighted one |
| Esc | Any side panel | Closes it |

## The counter

1. *Counter, Open a shift*: pick the terminal and the price list the counter sells from, and enter the cash in the drawer.
2. Scan or type an item code and press Enter. The code on the item is what the scanner reads. Change quantity, price or discount on the line.
3. Choose how the customer pays (split between cash, UPI and card if needed). For cash, enter what was given to see the change.
4. **Charge** (F9). Print or save the receipt.
5. **Returns** finds the original receipt, takes back the goods and refunds the customer.
6. **Close shift** at the end: count the drawer; any difference is posted to *cash over and short*.

**Customer wallet.** In the *Customer wallet* box on the counter, choose the customer to use their **store credit**, redeem **loyalty points**, or type a **coupon code** and press *Apply* (a coupon needs no customer). Points and coupons take money off the lines that allow discounts; items in a no-discount category are left alone. Store credit pays part of the bill, and you take the rest as usual. When a customer returns goods, choose *Store credit* under *Refund by* to keep the money for their next visit instead of paying it out. Named customers earn points on what they pay. Set the earning rate, what a point is worth and your coupons under *Point of sale, Loyalty and coupons*. The wallet needs a connection: a sale that uses it cannot be saved offline.

**Hold a bill.** Press *Hold bill* to set the current bill aside while you serve someone else; *Held bills* brings it back (it is kept on this computer and is not a sale until charged). After a sale, type the customer's mobile number and press *Send on WhatsApp* to open WhatsApp with the receipt ready to send.

**Staff at the counter.** Each line is credited to the signed-in cashier; pick another name under the item to credit someone else (needs permission to see users). A manager sets a PIN under *My account, Counter PIN*. If a limit is set under *Point of sale, Loyalty and coupons*, a discount above it asks for a manager to be chosen and their PIN entered before the sale goes through; five wrong PINs lock that manager for 15 minutes. A sale that needs approval cannot be saved offline.

**Receipt printer.** In the desktop app, *Shifts and setup, Setup, Receipt printer* chooses the printer receipts go to without a dialog (laid out for an 80 mm roll), and whether a receipt prints by itself after each sale. To open a cash drawer wired to the printer, turn on its "open drawer" option in the printer's driver.

**Starting categories.** *Master data, Categories, Start from a template* adds a ready set of categories for your kind of shop. Items can be imported with a *Category code*, *Brand* and *MRP* column, and the items list can be filtered by category.

**No connection?** If the counter was registered for offline selling (*Shifts and setup, Setup, Use this computer for offline selling*), sales are kept on the computer and uploaded with *Upload offline sales* when the connection is back. A sale the server refuses stays on screen with the reason and is not in the books: ask a manager before handing over the goods again. Returns need the connection.

## Your account

*My account* changes your password and turns two-step sign-in on or off. Recovery codes are shown once; keep them safe.

## When something goes wrong

Messages end with a reference such as `(reference 8cc1…)`. Give that to whoever runs your server: it finds the exact request in the logs and the audit log.
