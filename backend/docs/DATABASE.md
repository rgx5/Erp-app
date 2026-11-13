# Database (schema `erp`)

Roles: `erp_migrator` (owner, migrations only) · `erp_app` (runtime, restricted). Bootstrap: `db/bootstrap/bootstrap.sql`.
Functions: `erp.current_tenant_id()` (reads `app.tenant_id`), `erp.touch_row()` (bumps `version`, `updated_at`).
Every table has `version int`, `created_at`, `updated_at`; PK `(tenant_id, id)` except `tenants(id)`.

| table | purpose | key constraints |
| --- | --- | --- |
| tenants | customer account | RLS: `id = current tenant` |
| companies | legal entity | unique (tenant, code); PAN format check; FY start month |
| gst_registrations | GSTIN of a company (many per company) | gstin `char(15)` regex; `state_code = substr(gstin,1,2)`; type check; effective_from/to; unique (tenant, gstin); trigger: PAN in GSTIN = company PAN |
| business_locations | branch/site | FK (tenant, company, gst_registration) → registration of the same company; one principal per registration |
| warehouses | stock location | FK to location; `kind` check list |
| tenant_directory | slug -> tenant id for sign-in (**not** tenant-scoped; trigger-filled; read-only to erp_app) | pk slug |
| users | people who sign in | unique (tenant, email) lower-case; argon2id hash; MFA seed encrypted; lockout counters; custom trigger so sign-in bookkeeping does not bump `version` |
| roles / user_roles | permission sets; assignments (revoked by timestamp, never deleted) | unique (tenant, lower(name)); owner role `is_system` |
| sessions | one row per refresh token (rotating), `family_id` groups a login | SHA-256 token hash unique per tenant; `used_at`/`revoked_at` |
| api_keys | integration credentials | SHA-256 of secret; permission array; expiry; revoked_at |
| mfa_recovery_codes | single-use recovery codes (hashed) | unique (tenant, user, hash) |
| audit_log | append-only audit trail | INSERT/SELECT only + reject trigger for UPDATE/DELETE/TRUNCATE; action format check |
| idempotency_keys | request dedupe with stored response | pk (tenant, key); expiring |
| outbox_events | domain events, immutable | trigger rejects UPDATE/DELETE; insert enqueues a dispatch pointer |
| outbox_consumed | (event, consumer) done-marks | composite FK to the event |
| outbox_dispatch | delivery queue, pointers only (**not** tenant-scoped; trigger-filled) | partial index on due work; erp_app may SELECT/UPDATE only |
| number_series | one per GST registration x document type x financial year | composite FK to gst_registrations; format checks; unique scope |
| number_allocations | every number ever issued | unique (tenant, series, value); 16-char/charset check; trigger allows only issued -> cancelled |
| currencies / exchange_rates | tenant currencies; immutable dated rates | unique (tenant, code); rate unique per (from, to, date); composite FKs by code |
| units / item_uom_conversions | units with GST UQC; per-item alternative units | UQC check list; factor > 0 |
| tax_codes / tax_code_rates | tax code + effective-dated rate versions | **EXCLUDE no-overlap**; CGST = SGST = IGST/2; kind trigger; guard trigger (close-only, no delete) |
| items | item master | type/tracking/HSN-SAC/service/manufactured checks; case-insensitive unique code; identity trigger |
| payment_terms / parties / party_addresses | partners with roles, GST treatment, addresses | treatment <-> GSTIN check; PAN-in-GSTIN; unique GSTIN; one default address per kind |
| price_lists / price_list_items | price lists; effective-dated prices with quantity breaks | **EXCLUDE no-overlap** per (list, item, unit, min qty); guard trigger |
| accounts | chart of accounts per company | unique code; hierarchy via parent (group, same type); control_kind; structure frozen by trigger |
| fiscal_years / accounting_periods | years and monthly periods | **EXCLUDE no-overlap**; period status trigger (open<->closed, closed->locked, nothing else) |
| journal_counters | per company x year x type number counter | locked by the posting transaction |
| journal_entries / journal_lines | the immutable double-entry ledger | reject UPDATE/DELETE/TRUNCATE; period-open check (FOR SHARE); **deferred balance/header check at commit**; lines only from the creating transaction; one entry per source document+event; reversed at most once |
| company_stock_settings / inventory_accounts | GL accounts for stock (per item type), opening and adjustment offsets | inventory_accounts trigger: must be a postable asset control account |
| batches / stock_serials | batch records (status only changes) and serial numbers (move/issue only) | unique per item; guard triggers |
| stock_movements / stock_ledger / stock_ledger_serials / stock_layer_consumptions | the immutable stock subledger | reject UPDATE/DELETE/TRUNCATE; ledger lines only from the creating transaction; one movement per source; the journal link may be set once, in the same transaction |
| stock_balances / batch_balances / stock_layers | current quantity/value, batch quantity, FIFO layers (cache + cost layers) | row-locked per (warehouse, item); batch quantity >= 0; layer remaining bounded; tests prove balances = sum of ledger |
| stock_counters | movement numbers per company x year x prefix | locked by the posting transaction |
| stock_reservations | holds on stock for orders | consumed <= quantity; active/fulfilled/released; only consumption fields updatable |
| stock_transfers / stock_transfer_lines | warehouse transfers (direct or via in-transit) | direct => completed (check); received <= dispatched |
| stock_counts / stock_count_lines | physical counts | lines freeze once the count is not open (trigger) |
| sales_settings | GL accounts for receivable, sales, services, COGS, round-off, output taxes | each validated by account type/control kind in the API |
| sales_invoices / sales_invoice_lines | tax invoices, bills of supply, credit/debit notes | **header = sum of lines at commit**; CGST=SGST; IGST only inter-state; grand total reconciles; immutable except cancellation; unique number per registration + type |
| sales_quotes / sales_quote_lines | quotes with estimated totals | status-only mutation, once; lines immutable |
| sales_orders / sales_order_lines | orders, optional reservations, link to invoices | order status-only; order lines fixed except `quantity_invoiced` (<= quantity) |
| customer_receipts / receivable_allocations | money received; which receipt, credit note or write-off settles which invoice | receipts immutable except cancellation; allocations append-only (one reversal); **commit-time check: never more than the invoice, receipt or credit note holds**; exactly one source; same customer enforced by composite FK |
| schema_migrations | applied files + sha256 | owner-only (not granted to erp_app except read for readiness) |

Grants to `erp_app`: `SELECT, INSERT, UPDATE` only (audit_log, outbox_events, outbox_consumed: `SELECT, INSERT` only; number_allocations: `SELECT, INSERT` + `UPDATE` on the three cancellation columns). Policy on every table: `tenant_isolation TO erp_app USING / WITH CHECK (tenant_id = erp.current_tenant_id())`, with `ENABLE` and `FORCE ROW LEVEL SECURITY`.
Exact DDL: `db/migrations/0001_foundation.sql` ... `0011_receivables.sql`. The `btree_gist` extension is created by the admin bootstrap (`db/bootstrap/bootstrap.sql`), so a database must be bootstrapped with the Slice 2 version of that file.

**Tables outside RLS**: exactly three, enforced by a test: `schema_migrations` (metadata), `tenant_directory` (slug -> id), `outbox_dispatch` (queue pointers). The test also pins their column lists so business data cannot creep into them.

## Migration strategy
Forward-only; to undo, add a new migration. Expand/contract for breaking changes. Run as `erp_migrator` before the new app version starts
(compose and CI do this). `npm run db:status` lists applied/pending. Never edit an applied file (the runner refuses).
