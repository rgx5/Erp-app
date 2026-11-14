# OneSyncERP backend (Slice 0 + Slice 1)

NestJS 12 modular monolith on PostgreSQL 16 with Drizzle. Slice 0 is the platform foundation and the tenancy hierarchy
**Tenant → Company → GST registration → Business location → Warehouse**. Slice 8 adds payroll (employees and contract workers, effective-dated PF/ESI/PT/TDS rules, monthly runs, remittances), financial statements and year-end close, and GST returns (GSTR-1, GSTR-3B, ITC register, CMP-08). Slice 7 adds manufacturing: work centres, versioned BOMs and routings, work orders with WIP, costing and variances, subcontracting (job work). Slice 6d adds landed cost (freight, duty, insurance capitalised into inventory). Slice 6c adds supplier payments, allocation and payables (ageing, statements, ledger reconciliation). Slice 6b adds supplier bills (GST input credit, reverse charge, three-way match with approval override), debit notes, returns and stock revaluation. Slice 6a adds purchase orders and goods receipts with GRNI accrual. Slice 5d adds point of sale (counter sales and returns, cash-drawer shifts) and refunds. Slice 5c adds receipts and receivables (allocation, ageing, statements, ledger reconciliation). Slice 5b adds quotes and orders. Slice 5a adds sales invoicing with the GST engine (tax invoices, bills of supply, credit/debit notes, cancellation). Slice 4 adds the inventory subledger (WAC + FIFO, batches, serials, GL posting, reconciliation, reservations, transfers, counts). Slice 3 adds the accounting core (chart of accounts, periods with locking, immutable double-entry journal, trial balance). Slice 2 adds master data (currencies, units, tax codes with effective-dated rates, items, parties, price lists). Slice 1 adds identity (users, roles, sessions, API keys, MFA), the audit log, idempotency, the transactional outbox and document number series. No business modules yet.

Docs: [ARCHITECTURE.md](docs/ARCHITECTURE.md) (decisions) · [DATABASE.md](docs/DATABASE.md) (schema, RLS, migrations) ·
[TESTING.md](docs/TESTING.md) (tests, RLS verification, performance) · [openapi.json](docs/openapi.json) (API; also `/docs` when running).

## Run
```bash
docker compose up --build            # postgres + migrations + api on :8080
# or locally (needs npm >= 11, Node >= 22.22):
npm ci
bash scripts/pg-local.sh             # throwaway PostgreSQL on :5434 (dev only)
npm run test:all
```
Roles/schema bootstrap is a one-time admin step (`npm run db:bootstrap`), migrations run as the owner role
(`npm run db:migrate`), the API runs as the restricted `erp_app` role and refuses to start if that role is unsafe.

## Layout
```
backend/
  db/bootstrap/bootstrap.sql     roles + schema (admin, once)
  db/migrations/NNNN_*.sql       forward-only SQL, checksummed
  src/config                     zod-validated environment
  src/db                         migrator, bootstrap, Drizzle schema mirror, migration CLI
  src/platform/{database,http,logging,health,tenancy}
  src/modules/organization       tenancy hierarchy API
  src/modules/identity           authentication, users, roles, API keys, MFA
  src/modules/masterdata         currencies, units, tax, items, parties, price lists
  src/modules/sales              GST engine, invoices/notes, orders, receipts and receivables
  src/modules/purchasing          purchase orders, goods receipts, GRNI
  src/modules/manufacturing       work centres, BOMs, work orders, WIP
  src/modules/gst                 GSTR-1, GSTR-3B, ITC register, CMP-08
  src/modules/payroll             employees, salary structures, statutory rules, runs
  src/modules/pos                terminals, shifts, counter sales and returns
  src/modules/inventory          stock ledger, valuation, batches, serials, reconciliation
  src/modules/accounting         chart of accounts, periods, posting engine, trial balance
  src/modules/audit, numbering   audit-log read API; document number series
  src/platform/services          audit writer, idempotency, outbox + relay
  test/integration               real PostgreSQL, the real erp_app role
  scripts/                       perf, bootstrap, openapi export
```
