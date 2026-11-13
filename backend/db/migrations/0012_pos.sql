-- Point of sale: terminals, cash-drawer shifts, counter sales (an invoice plus the payments taken at the till) and counter returns
-- (a credit note plus the refund paid out). Also adds refunds of credit balances to receivables, which returns need.

-- A refund pays a customer back money held for them: unallocated receipts (advances) or credit notes.
CREATE TABLE erp.customer_refunds (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  company_id         uuid          NOT NULL,
  refund_no          text          NOT NULL,
  customer_id        uuid          NOT NULL,
  refund_date        date          NOT NULL,
  amount             numeric(18,4) NOT NULL,
  method             text          NOT NULL,
  paid_from_account_id uuid        NOT NULL,
  receipt_id         uuid,
  credit_note_id     uuid,
  reference          text,
  journal_entry_id   uuid          NOT NULL,
  created_by         uuid,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id, receipt_id) REFERENCES erp.customer_receipts (tenant_id, customer_id, id),
  FOREIGN KEY (tenant_id, customer_id, credit_note_id) REFERENCES erp.sales_invoices (tenant_id, customer_id, id),
  FOREIGN KEY (tenant_id, company_id, paid_from_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT customer_refunds_no_unique UNIQUE (tenant_id, company_id, refund_no),
  CONSTRAINT customer_refunds_amount_positive CHECK (amount > 0),
  CONSTRAINT customer_refunds_method_valid CHECK (method IN ('cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other')),
  CONSTRAINT customer_refunds_one_source CHECK ((receipt_id IS NOT NULL) <> (credit_note_id IS NOT NULL))
);
CREATE INDEX customer_refunds_receipt_idx ON erp.customer_refunds (tenant_id, receipt_id) WHERE receipt_id IS NOT NULL;
CREATE INDEX customer_refunds_credit_idx ON erp.customer_refunds (tenant_id, credit_note_id) WHERE credit_note_id IS NOT NULL;
CREATE TRIGGER customer_refunds_immutable BEFORE UPDATE OR DELETE ON erp.customer_refunds FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

-- Allocations AND refunds together may never exceed what a receipt or credit note holds.
CREATE OR REPLACE FUNCTION erp.check_receivable_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  held numeric;
  used numeric;
BEGIN
  SELECT grand_total INTO held FROM erp.sales_invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.invoice_id;
  SELECT COALESCE(sum(amount), 0) INTO used FROM erp.receivable_allocations WHERE tenant_id = NEW.tenant_id AND invoice_id = NEW.invoice_id AND reversed_at IS NULL;
  IF used > held THEN RAISE EXCEPTION 'allocations exceed the invoice value' USING ERRCODE = '23514'; END IF;
  IF NEW.receipt_id IS NOT NULL THEN
    SELECT amount INTO held FROM erp.customer_receipts WHERE tenant_id = NEW.tenant_id AND id = NEW.receipt_id;
    SELECT COALESCE(sum(amount), 0) INTO used FROM erp.receivable_allocations WHERE tenant_id = NEW.tenant_id AND receipt_id = NEW.receipt_id AND reversed_at IS NULL;
    used := used + COALESCE((SELECT sum(amount) FROM erp.customer_refunds WHERE tenant_id = NEW.tenant_id AND receipt_id = NEW.receipt_id), 0);
    IF used > held THEN RAISE EXCEPTION 'allocations and refunds exceed the receipt amount' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.credit_note_id IS NOT NULL THEN
    SELECT grand_total INTO held FROM erp.sales_invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.credit_note_id;
    SELECT COALESCE(sum(amount), 0) INTO used FROM erp.receivable_allocations WHERE tenant_id = NEW.tenant_id AND credit_note_id = NEW.credit_note_id AND reversed_at IS NULL;
    used := used + COALESCE((SELECT sum(amount) FROM erp.customer_refunds WHERE tenant_id = NEW.tenant_id AND credit_note_id = NEW.credit_note_id), 0);
    IF used > held THEN RAISE EXCEPTION 'allocations and refunds exceed the credit note value' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE FUNCTION erp.check_customer_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  held numeric;
  used numeric;
BEGIN
  IF NEW.receipt_id IS NOT NULL THEN
    SELECT amount INTO held FROM erp.customer_receipts WHERE tenant_id = NEW.tenant_id AND id = NEW.receipt_id;
    SELECT COALESCE(sum(amount), 0) INTO used FROM erp.receivable_allocations WHERE tenant_id = NEW.tenant_id AND receipt_id = NEW.receipt_id AND reversed_at IS NULL;
    used := used + (SELECT COALESCE(sum(amount), 0) FROM erp.customer_refunds WHERE tenant_id = NEW.tenant_id AND receipt_id = NEW.receipt_id);
  ELSE
    SELECT grand_total INTO held FROM erp.sales_invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.credit_note_id;
    SELECT COALESCE(sum(amount), 0) INTO used FROM erp.receivable_allocations WHERE tenant_id = NEW.tenant_id AND credit_note_id = NEW.credit_note_id AND reversed_at IS NULL;
    used := used + (SELECT COALESCE(sum(amount), 0) FROM erp.customer_refunds WHERE tenant_id = NEW.tenant_id AND credit_note_id = NEW.credit_note_id);
  END IF;
  IF used > held THEN RAISE EXCEPTION 'refunds exceed what the source holds' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER customer_refunds_check AFTER INSERT ON erp.customer_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_customer_refund();

-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.pos_settings (
  tenant_id                 uuid        NOT NULL,
  company_id                uuid        NOT NULL,
  walk_in_customer_id       uuid,
  cash_variance_account_id  uuid,
  version                   integer     NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, walk_in_customer_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, cash_variance_account_id) REFERENCES erp.accounts (tenant_id, company_id, id)
);
CREATE TRIGGER pos_settings_touch BEFORE UPDATE ON erp.pos_settings FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

-- Where each way of paying lands in the ledger (cash -> the till/cash account, card/upi -> the bank or clearing account ...).
CREATE TABLE erp.pos_payment_accounts (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  method      text        NOT NULL,
  account_id  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  CONSTRAINT pos_payment_accounts_unique UNIQUE (tenant_id, company_id, method),
  CONSTRAINT pos_payment_accounts_method_valid CHECK (method IN ('cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other'))
);
CREATE TRIGGER pos_payment_accounts_touch BEFORE UPDATE ON erp.pos_payment_accounts FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

CREATE TABLE erp.pos_terminals (
  tenant_id             uuid        NOT NULL,
  id                    uuid        NOT NULL,
  company_id            uuid        NOT NULL,
  code                  text        NOT NULL,
  name                  text        NOT NULL,
  gst_registration_id   uuid        NOT NULL,
  business_location_id  uuid        NOT NULL,
  warehouse_id          uuid        NOT NULL,
  status                text        NOT NULL DEFAULT 'active',
  version               integer     NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, gst_registration_id) REFERENCES erp.gst_registrations (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, business_location_id) REFERENCES erp.business_locations (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  CONSTRAINT pos_terminals_code_unique UNIQUE (tenant_id, company_id, code),
  CONSTRAINT pos_terminals_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  CONSTRAINT pos_terminals_status_valid CHECK (status IN ('active', 'inactive'))
);
CREATE TRIGGER pos_terminals_touch BEFORE UPDATE ON erp.pos_terminals FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

CREATE TABLE erp.pos_shifts (
  tenant_id            uuid          NOT NULL,
  id                   uuid          NOT NULL,
  company_id           uuid          NOT NULL,
  terminal_id          uuid          NOT NULL,
  shift_no             text          NOT NULL,
  opened_by            uuid          NOT NULL,
  opened_at            timestamptz   NOT NULL DEFAULT now(),
  opening_cash         numeric(18,4) NOT NULL,
  status               text          NOT NULL DEFAULT 'open',
  closed_by            uuid,
  closed_at            timestamptz,
  counted_cash         numeric(18,4),
  expected_cash        numeric(18,4),
  variance             numeric(18,4),
  variance_entry_id    uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, terminal_id) REFERENCES erp.pos_terminals (tenant_id, id),
  FOREIGN KEY (tenant_id, opened_by) REFERENCES erp.users (tenant_id, id),
  FOREIGN KEY (tenant_id, closed_by) REFERENCES erp.users (tenant_id, id),
  FOREIGN KEY (tenant_id, variance_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  CONSTRAINT pos_shifts_no_unique UNIQUE (tenant_id, company_id, shift_no),
  CONSTRAINT pos_shifts_company_key UNIQUE (tenant_id, company_id, id),
  CONSTRAINT pos_shifts_opening_valid CHECK (opening_cash >= 0),
  CONSTRAINT pos_shifts_status_valid CHECK (status IN ('open', 'closed')),
  CONSTRAINT pos_shifts_closed_consistent CHECK ((status = 'closed') = (closed_at IS NOT NULL AND counted_cash IS NOT NULL AND expected_cash IS NOT NULL AND variance IS NOT NULL AND closed_by IS NOT NULL))
);
-- At most one open shift per terminal.
CREATE UNIQUE INDEX pos_shifts_one_open ON erp.pos_shifts (tenant_id, terminal_id) WHERE status = 'open';
CREATE FUNCTION erp.guard_pos_shift() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'open' OR NEW.status <> 'closed'
     OR (to_jsonb(NEW) - 'status' - 'closed_by' - 'closed_at' - 'counted_cash' - 'expected_cash' - 'variance' - 'variance_entry_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'closed_by' - 'closed_at' - 'counted_cash' - 'expected_cash' - 'variance' - 'variance_entry_id') THEN
    RAISE EXCEPTION 'a shift can only be closed, once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_shifts_guard BEFORE UPDATE OR DELETE ON erp.pos_shifts FOR EACH ROW EXECUTE FUNCTION erp.guard_pos_shift();

-- A counter sale or return: the invoice/credit note it produced, in which shift, and how it was paid.
CREATE TABLE erp.pos_sales (
  tenant_id    uuid        NOT NULL,
  id           uuid        NOT NULL,
  company_id   uuid        NOT NULL,
  shift_id     uuid        NOT NULL,
  terminal_id  uuid        NOT NULL,
  kind         text        NOT NULL,
  document_id  uuid        NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, shift_id) REFERENCES erp.pos_shifts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, terminal_id) REFERENCES erp.pos_terminals (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES erp.sales_invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT pos_sales_document_unique UNIQUE (tenant_id, document_id),
  CONSTRAINT pos_sales_kind_valid CHECK (kind IN ('sale', 'return'))
);
CREATE INDEX pos_sales_shift_idx ON erp.pos_sales (tenant_id, shift_id);

CREATE TABLE erp.pos_payments (
  tenant_id     uuid          NOT NULL,
  id            uuid          NOT NULL,
  pos_sale_id   uuid          NOT NULL,
  method        text          NOT NULL,
  amount        numeric(18,4) NOT NULL,
  tendered      numeric(18,4) NOT NULL,
  change_given  numeric(18,4) NOT NULL DEFAULT 0,
  reference     text,
  receipt_id    uuid,
  refund_id     uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, pos_sale_id) REFERENCES erp.pos_sales (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES erp.customer_receipts (tenant_id, id),
  FOREIGN KEY (tenant_id, refund_id) REFERENCES erp.customer_refunds (tenant_id, id),
  CONSTRAINT pos_payments_amount_positive CHECK (amount > 0),
  CONSTRAINT pos_payments_change_valid CHECK (change_given >= 0 AND tendered = amount + change_given),
  CONSTRAINT pos_payments_one_ledger_link CHECK ((receipt_id IS NOT NULL) <> (refund_id IS NOT NULL))
);
CREATE TRIGGER pos_sales_immutable BEFORE UPDATE OR DELETE ON erp.pos_sales FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER pos_payments_immutable BEFORE UPDATE OR DELETE ON erp.pos_payments FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_refunds', 'pos_settings', 'pos_payment_accounts', 'pos_terminals', 'pos_shifts', 'pos_sales', 'pos_payments'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.customer_refunds, erp.pos_sales, erp.pos_payments, erp.pos_shifts TO erp_app;
GRANT SELECT, INSERT, UPDATE ON erp.pos_settings, erp.pos_payment_accounts, erp.pos_terminals TO erp_app;
GRANT UPDATE (status, closed_by, closed_at, counted_cash, expected_cash, variance, variance_entry_id) ON erp.pos_shifts TO erp_app;
