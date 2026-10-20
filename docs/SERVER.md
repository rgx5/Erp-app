# Kosh Server

The standalone backend for the full ERP. It is a small, boring server on purpose: **it stores documents, enforces who may
write them, and keeps the few numbers that must be atomic (stock on hand, customer balances)** — everything else is
computed by the app from the documents, with the same pure TypeScript the server can load.

Stack: Node 22, TypeScript, Fastify, PostgreSQL 16. Lives in `server/` of this repository and imports the app's pure code
(`src/replication`, `src/domain`, `src/modules/*/replication.ts`) so the rules exist once.

## Concepts

| | |
| --- | --- |
| **Org** | One business (the tenant). Everything is scoped to an org; no request can see another's data. |
| **Branch** | An outlet of the org. Documents may belong to a branch (`branchId`); a person may be limited to some branches. |
| **User** | A person with a role. Signs in with email + password (owner / manager) or with a PIN at the counter. |
| **Role** | A set of permissions. Three built in (owner, manager, cashier — `ROLE_PERMISSIONS`); orgs can define their own. |
| **Device** | A phone or till. Has an id, a name, can be revoked. Its writes are numbered `${deviceId}:${n}`. |
| **Document** | A JSON record in a named **collection**, with a server-assigned increasing **revision**. |

## Collections and the replication rules

`src/replication/registry.ts` is the contract. Every collection declares:

* `kind` — `master` (editable; concurrent edits merge field by field, last writer wins), `ledger` (a posted document: created
  once, never edited or deleted, except the `patchable` fields), or `managed` (written only through the REST API: users).
* `perm` — the permission needed to write; `readPerm` — needed to receive it on a pull.
* `owned` — fields the server maintains (e.g. `variants.stock`). A client patch to them is ignored.
* `effects(doc)` — what posting a document does to *other* documents (a stock movement changes the variant's stock; a bill moves
  the customer's points). Pure functions, run **inside the same transaction** as the write, so the numbers cannot drift.

`src/replication/apply.ts` implements `applyMutations` and `pullChanges` against an abstract `DocStore`. **The server must not
re-implement these rules**: it implements `DocStore` for PostgreSQL (`PgDocStore`) and calls `applyMutations` /
`pullChanges`. Tests run the same rules against `MemoryDocStore`.

## HTTP API

JSON in and out. Errors are `{ "error": "message", "code"?: "…" }`. All routes except those marked *public* need
`Authorization: Bearer <token>`. Base path: `/` (the app appends nothing; the address people type is the origin).

### Public

| Route | |
| --- | --- |
| `GET /health` | `{ app: 'kosh-server', version, time }` — the app uses `app` to tell a Kosh server from a Krishna-compatible one. |
| `POST /auth/signup` | `{ orgName, ownerName, email, password, pin?, industry?, deviceId, deviceName }` → creates org + owner + default branch → `{ token, user, org, branch, device }`. |
| `POST /auth/login` | `{ email, password, deviceId, deviceName }` → `{ token, user, org, branches }`. 401 on bad credentials; throttled (429 after repeated failures, per email+IP). |
| `POST /auth/pin-login` | `{ orgId, userId, pin, deviceId, deviceName }` → same shape. Throttled; lockout escalates like the app's local PIN. |
| `GET /auth/staff?orgId=` | `[{ id, name, role, active, code }]` — for the "who is at the counter" screen. Never any credential. |
| `GET /p/:token` | A shared document (a bill) rendered as an HTML invoice, from `POST /share`. No sign-in. |

### Signed in

| Route | |
| --- | --- |
| `POST /auth/refresh` | → `{ token }` (new 12 h token). |
| `GET /auth/me` | `{ user, org, role, permissions: string[], branches }` (permissions resolved server-side). |
| `POST /auth/logout` | Revokes this device's token. |
| `GET /sync/pull?since=<cursor>&limit=<n>` | → `PullResult` (`src/replication/types.ts`): `{ cursor, hasMore, upserts, deletes }`, limited to collections and branches the person may read. `since=0` is the first download. |
| `POST /sync/push` | `{ mutations: Mutation[] }` (≤ 200, in order) → `{ results: MutationResult[], cursor }`. One result per mutation; a refusal never blocks the next. |
| `GET /sync/info` | The collection registry as the server knows it (name, kind, perms) — for diagnostics. |
| `GET /users` · `POST /users` · `PUT /users/:id` · `POST /users/:id/pin` | Staff management (`settings` permission). Create takes `{ name, role, pin, email?, password?, code?, active?, branches? }`. The `users` collection documents are written by the server from these. |
| `GET /roles` · `POST /roles` · `PUT /roles/:id` · `DELETE /roles/:id` | Custom roles `{ name, permissions: string[] }` (owner). |
| `GET /branches` · `POST /branches` · `PUT /branches/:id` | Outlets (owner). |
| `GET /org` · `PUT /org` | Org profile and plan (owner). |
| `GET /devices` · `DELETE /devices/:id` | List and revoke devices (owner). A revoked device's token stops working at once. |
| `POST /files` | Raw bytes with `Content-Type`; header `X-Filename`. → `{ id, url, size }`. Max 10 MB. Stored through a `FileStore` interface (local disk driver). |
| `GET /files/:id` | The bytes (org-scoped). |
| `POST /share` | `{ coll: 'bills', id }` → `{ token, url }` — a public link to the rendered invoice. |
| `GET /backup` | The whole org as one JSON document (owner). `POST /restore` replaces it (owner, empty orgs only). |
| `POST /devices/push-token` | `{ token, platform }` for push notifications. |
| `POST /api-keys` · `GET /api-keys` · `DELETE /api-keys/:id` | Integration keys (owner). A key may be used as the bearer token with the permissions it was given. |

## Mutations

```ts
{ mid: 'dev_7f3a:42', coll: 'products', id: 'prd_x', op: 'create' | 'patch' | 'delete', data?, at }
```

* **Idempotent**: a `mid` seen before returns `duplicate` and changes nothing (a retry after a lost reply is harmless).
* `create` sends the whole document. For a **ledger** collection an existing id answers `duplicate`.
* `patch` sends only the fields that changed; `null` removes a field. Owned fields are ignored.
* `delete` is allowed on master collections only; the document becomes a tombstone so other devices learn of it.
* Refusals carry a `code`: `unknown_collection`, `forbidden`, `managed`, `immutable`, `not_found`, `invalid`, `too_large`,
  `branch_forbidden`.
* **Revisions** are assigned from a per-org counter taken under a row lock, so revisions commit in order and a puller using
  `since=<cursor>` can never miss a document.

## Numbers the server keeps

Defined by `effects` in the registry; today:

| Posting this… | …does this |
| --- | --- |
| `moves` (stock movement) | `variants.stock += qty` |
| `bills` (a sale) | `customers.loyaltyPoints += earned − redeemed`, `customers.storeCredit −= creditUsed` |
| `bills` (a credit note) | points reversed (floor 0), store credit added for a credit refund, the original bill's `returnedQty` and `status` updated |

Modules add their own (receivables, batch stock, ledger balances…) in their `replication.ts`; the server picks them up from
`src/modules/replication-all.ts`.

## Security model

* Passwords and PINs are bcrypt-hashed; tokens are HS256 JWTs (`sub`, `org`, `dev`, `ver`), 12 h, refreshable; revoking a device
  or changing a password bumps the version and invalidates old tokens.
* Permissions are resolved per request from the role (custom roles included) — never trusted from the token.
* Org isolation: every query carries `org_id`; there is a test that proves org A cannot read, write, or guess org B's ids.
* The server stores documents **as the app computed them** (a bill's tax is not recomputed), the same trust model the
  Krishna server has. Collections can add `validate` rules; recomputing bills server-side is the next hardening step.

## Running it

```bash
cd server && npm install
export DATABASE_URL=postgresql://… JWT_SECRET=$(openssl rand -hex 32) PORT=8090
npm run migrate && npm start         # or: docker compose up
```

See [LIVE-TESTING.md](./LIVE-TESTING.md) for the throwaway-PostgreSQL recipe used by the tests.
