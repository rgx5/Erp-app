# Cloud API contract

Kosh talks to the **Krishna Collection billing cloud API** (NestJS + PostgreSQL, `krishna-collection-billing/backend`)
unchanged. Every business a client runs on the web/desktop product can be opened on a phone by entering the server
address and signing in; no server work is needed to ship the app.

All paths are relative to the server address the user enters (for example `https://billing.example.com`). Bodies are
JSON. Errors are `{ "error": "message" }` with an HTTP status. Every route except `health`, `auth/login`,
`auth/web-login` and `GET /users` requires `Authorization: Bearer <token>`.

## Sign-in

| Purpose | Route | Notes |
| --- | --- | --- |
| Reachability | `GET /health` | `{ ok: true }`; used by the "Test connection" button |
| Owner/manager sign-in | `POST /auth/web-login` `{ email, password }` | → `{ token, user, store }` |
| Staff PIN sign-in | `POST /auth/login` `{ storeId, userId, pin }` | → `{ token, user, store }`; `429` when throttled |
| Who can sign in | `GET /users?storeId=` | public: id, name, role, active, code — **never** PIN hashes |
| Token refresh | `POST /auth/refresh` | → `{ token }`; called when < 3 h of life remain |

The app reads only the `exp` claim of the token to schedule refreshes; it never trusts it for access.

## Reads

`GET /sync/snapshot` returns one internally consistent (REPEATABLE READ), role-filtered copy of the store:

```ts
{ serverTime, store, users, categories, products, variants, customers, coupons,
  bills, suppliers, purchases, moves, expenses, sessions }
```

Cashiers receive `[]` for suppliers, purchases, moves, expenses and sessions. Types are declared in
`src/domain/types.ts` and `src/data/api.ts` (`Snapshot`) and are field-for-field the server's JSON.

`GET /bills/:id` is used to verify a `409` on a bill (see below).

## Writes (the outbox)

Every local change is queued as one outbox entry and sent in order. One entity ↔ one route:

| Entity | Request | Permission |
| --- | --- | --- |
| `bill` | `POST /bills` | pos |
| `billReturn` | `POST /bills/:originalId/return` | pos |
| `customer` / `customerUpdate` | `POST /customers` / `PUT /customers/:id` | customers |
| `product` / `productUpdate` / `productDelete` | `POST /products` / `PUT /products/:id` / `DELETE /products/:id` | inventory |
| `variant` / `variantUpdate` | `POST /variants` / `PUT /variants/:id` | inventory |
| `category` / `categoryDelete` | `POST /categories` / `DELETE /categories/:id` | inventory |
| `stockAdjust` | `POST /stock/adjust` | stock |
| `purchase` | `POST /purchases` | purchases |
| `supplier` / `supplierUpdate` | `POST /suppliers` / `PUT /suppliers/:id` | purchases |
| `expense` | `POST /expenses` (append-only) | expenses |
| `session` / `sessionUpdate` | `POST /sessions` / `PUT /sessions/:id` (day open / close) | reports |
| `coupon` / `couponUpdate` | `POST /coupons` / `PUT /coupons/:id` | settings |
| `user` / `userUpdate` | `POST /users` / `PUT /users/:id` | settings |
| `storeUpdate` | `PUT /store` | settings |

The server **stores bills exactly as the client computed them** (tax and discount are not recomputed) and applies the
stock, loyalty and credit side-effects itself. The app therefore sends the bill and *only* the bill — it never also
posts the stock movement.

### Delivery semantics

* Client-generated ids (`bill_…`, `po_…`) make every write **idempotent**; a retry after a lost response returns `409`.
* `409` = already stored → entry marked done. **Exception:** for `bill`/`billReturn` the app first calls
  `GET /bills/:id`. If the id is there, done. If not, another device took the *invoice number* — the entry is kept and
  surfaced, never silently dropped.
* `400 403 404 405 410 413 422` are *permanent*: retried 3× then set aside (shown on the Sync screen, retryable).
* `401` pauses the queue and asks for a fresh sign-in; the queued data is kept.
* Anything else (5xx, `429`, network) stops the flush in place so ordering is preserved, then retries with the next
  trigger (reconnect, foreground, a new change).

### Document numbers on shared stores

The web till numbers invoices from `store.nextInvoiceNo`. A phone must not use that counter, or two devices would
issue the same number. Connected phones number documents `PREFIX-<DEVICE>-<SEQ>` (for example `INV-M4X-0001`,
`CN-M4X-0001`, `GRN-M4X-0001`), where `<DEVICE>` is a short random tag created when the phone connects. Barcodes for
items created on a phone come from a per-device base so they can't collide either.

## Industry data on the existing schema

Nothing industry-specific needs new columns. The generic item fields already exist in the Krishna schema
(`unit`, `fractional`, `step`, `minQty`, `trackStock`, `noDiscount`, `gstRate`, `hsn`) and the two free attributes use
the existing `fabric` / `season` columns, which each industry pack relabels (Composition / Shelf life for pharmacy,
Model / Warranty for electronics, …). The first and second option axes use `size` / `color`.

## Recommended server improvements (not required)

These make mobile fleets cheaper and safer; each is backwards compatible.

1. **Delta sync** — `GET /sync/snapshot?since=<serverTime>` returning changed rows + tombstones. Today the app pulls a
   full snapshot, but only when nothing is pending, so it is correct — just heavier on large stores.
2. **Refresh tokens / device registration** — so a lost phone can be revoked without rotating the shared secret.
3. **Recompute bills server-side** before accepting third-party writers (noted in the server's own comments).
4. **`Idempotency-Key` header** on writes, in addition to client ids.
5. **Push notifications** (low stock, day-close reminders) via a device-token endpoint.
6. **Expense edit/delete** endpoints; today expenses are append-only, so the app hides edit/delete in connected mode.
