-- Customer receivables: receipts, allocation of receipts / credit notes / write-offs to invoices, due dates.
-- The receivable itself is the general ledger (receivables control account, customer as dimension); these tables say which
-- money settles which invoice, and the database refuses to settle more than an invoice is worth or a source holds.

ALTER TABLE erp.sales_invoices ADD COLUMN due_date date;
ALTER TABLE erp.sales_invoices ADD CONSTRAINT sales_invoices_customer_key UNIQUE (tenant_id, customer_id, id);
ALTER TABLE erp.sales_settings ADD COLUMN write_off_account_id uuid;
ALTER TABLE erp.sales_settings ADD FOREIGN KEY (tenant_id, company_id, write_off_account_id) REFERENCES erp.accounts (tenant_id, company_id, id);

CREATE TABLE erp.customer_receipts (
  tenant_id                uuid          NOT NULL,
  id                       uuid          NOT NULL,
  company_id               uuid          NOT NULL,
  receipt_no               text          NOT NULL,
  customer_id              uuid          NOT NULL,
  receipt_date             date          NOT NULL,
  amount                   numeric(18,4) NOT NULL,
  method                   text          NOT NULL,
  deposit_account_id       uuid          NOT NULL,
  reference                text,
  notes                    text,
  journal_entry_id         uuid,
  status                   text          NOT NULL DEFAULT 'posted',
  cancelled_at             timestamptz,
  cancel_date              date,
  cancel_reason            text,
  cancel_journal_entry_id  uuid,
  created_by               uuid,
  created_at               timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, deposit_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, cancel_journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT customer_receipts_no_unique UNIQUE (tenant_id, company_id, receipt_no),
  CONSTRAINT customer_receipts_customer_key UNIQUE (tenant_id, customer_id, id),
  CONSTRAINT customer_receipts_amount_positive CHECK (amount > 0),
  CONSTRAINT customer_receipts_method_valid CHECK (method IN ('cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other')),
  CONSTRAINT customer_receipts_status_valid CHECK (status IN ('posted', 'cancelled')),
  CONSTRAINT customer_receipts_cancel_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_date IS NOT NULL AND cancel_reason IS NOT NULL))
);

CREATE FUNCTION erp.guard_customer_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'cancelled' OR NEW.status <> 'cancelled'
     OR (to_jsonb(NEW) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id') THEN
    RAISE EXCEPTION 'a receipt is immutable; it can only be cancelled once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_receipts_guard BEFORE UPDATE OR DELETE ON erp.customer_receipts FOR EACH ROW EXECUTE FUNCTION erp.guard_customer_receipt();

-- Which money settles which invoice. Exactly one source: a receipt, a credit note, or a write-off (its journal entry).
CREATE TABLE erp.receivable_allocations (
  tenant_id            uuid          NOT NULL,
  id                   uuid          NOT NULL,
  company_id           uuid          NOT NULL,
  customer_id          uuid          NOT NULL,
  invoice_id           uuid          NOT NULL,
  receipt_id           uuid,
  credit_note_id       uuid,
  write_off_entry_id   uuid,
  amount               numeric(18,4) NOT NULL,
  allocated_on         date          NOT NULL,
  reason               text,
  reversed_on          date,
  reversed_at          timestamptz,
  created_by           uuid,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id, invoice_id) REFERENCES erp.sales_invoices (tenant_id, customer_id, id),
  FOREIGN KEY (tenant_id, customer_id, receipt_id) REFERENCES erp.customer_receipts (tenant_id, customer_id, id),
  FOREIGN KEY (tenant_id, customer_id, credit_note_id) REFERENCES erp.sales_invoices (tenant_id, customer_id, id),
  FOREIGN KEY (tenant_id, write_off_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT receivable_allocations_amount_positive CHECK (amount > 0),
  CONSTRAINT receivable_allocations_one_source CHECK ((receipt_id IS NOT NULL)::int + (credit_note_id IS NOT NULL)::int + (write_off_entry_id IS NOT NULL)::int = 1),
  CONSTRAINT receivable_allocations_reversal_consistent CHECK ((reversed_at IS NULL) = (reversed_on IS NULL)),
  CONSTRAINT receivable_allocations_write_off_final CHECK (write_off_entry_id IS NULL OR reversed_at IS NULL)
);
CREATE INDEX receivable_allocations_invoice_idx ON erp.receivable_allocations (tenant_id, invoice_id) WHERE reversed_at IS NULL;
CREATE INDEX receivable_allocations_receipt_idx ON erp.receivable_allocations (tenant_id, receipt_id) WHERE reversed_at IS NULL;
CREATE INDEX receivable_allocations_credit_idx ON erp.receivable_allocations (tenant_id, credit_note_id) WHERE reversed_at IS NULL;

-- Only the reversal marker may change, and only once; write-offs are final (they are journal entries).
CREATE FUNCTION erp.guard_receivable_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.reversed_at IS NOT NULL OR NEW.reversed_at IS NULL OR OLD.write_off_entry_id IS NOT NULL
     OR (to_jsonb(NEW) - 'reversed_on' - 'reversed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'reversed_on' - 'reversed_at') THEN
    RAISE EXCEPTION 'an allocation can only be reversed once (write-offs never)' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receivable_allocations_guard BEFORE UPDATE OR DELETE ON erp.receivable_allocations FOR EACH ROW EXECUTE FUNCTION erp.guard_receivable_allocation();

-- At COMMIT: what is allocated against an invoice never exceeds its value, and what is drawn from a receipt or credit note never
-- exceeds what it holds. (The application checks first and says why; this is the backstop for concurrent requests.)
CREATE FUNCTION erp.check_receivable_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF used > held THEN RAISE EXCEPTION 'allocations exceed the receipt amount' USING ERRCODE = '23514'; END IF;
  ELSIF NEW.credit_note_id IS NOT NULL THEN
    SELECT grand_total INTO held FROM erp.sales_invoices WHERE tenant_id = NEW.tenant_id AND id = NEW.credit_note_id;
    SELECT COALESCE(sum(amount), 0) INTO used FROM erp.receivable_allocations WHERE tenant_id = NEW.tenant_id AND credit_note_id = NEW.credit_note_id AND reversed_at IS NULL;
    IF used > held THEN RAISE EXCEPTION 'allocations exceed the credit note value' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER receivable_allocations_check AFTER INSERT ON erp.receivable_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_receivable_allocation();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customer_receipts', 'receivable_allocations'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.customer_receipts, erp.receivable_allocations TO erp_app;
GRANT UPDATE (status, cancelled_at, cancel_date, cancel_reason, cancel_journal_entry_id) ON erp.customer_receipts TO erp_app;
GRANT UPDATE (reversed_on, reversed_at) ON erp.receivable_allocations TO erp_app;
