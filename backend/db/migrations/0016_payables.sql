-- Supplier payables: payments, allocation of payments / debit notes to bills, refunds from suppliers.
-- The payable itself is the general ledger (payables control account, supplier as dimension); these tables say which money
-- settles which bill, and the database refuses to settle more than a bill is worth or a source holds.

ALTER TABLE erp.supplier_bills ADD CONSTRAINT supplier_bills_supplier_key UNIQUE (tenant_id, supplier_id, id);

CREATE TABLE erp.supplier_payments (
  tenant_id                uuid          NOT NULL,
  id                       uuid          NOT NULL,
  company_id               uuid          NOT NULL,
  payment_no               text          NOT NULL,
  supplier_id              uuid          NOT NULL,
  payment_date             date          NOT NULL,
  amount                   numeric(18,4) NOT NULL,
  method                   text          NOT NULL,
  paid_from_account_id     uuid          NOT NULL,
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
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, paid_from_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, cancel_journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT supplier_payments_no_unique UNIQUE (tenant_id, company_id, payment_no),
  CONSTRAINT supplier_payments_supplier_key UNIQUE (tenant_id, supplier_id, id),
  CONSTRAINT supplier_payments_amount_positive CHECK (amount > 0),
  CONSTRAINT supplier_payments_method_valid CHECK (method IN ('cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other')),
  CONSTRAINT supplier_payments_status_valid CHECK (status IN ('posted', 'cancelled')),
  CONSTRAINT supplier_payments_cancel_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_date IS NOT NULL AND cancel_reason IS NOT NULL))
);
CREATE FUNCTION erp.guard_supplier_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'cancelled' OR NEW.status <> 'cancelled'
     OR (to_jsonb(NEW) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id') THEN
    RAISE EXCEPTION 'a payment is immutable; it can only be cancelled once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_payments_guard BEFORE UPDATE OR DELETE ON erp.supplier_payments FOR EACH ROW EXECUTE FUNCTION erp.guard_supplier_payment();

-- Which money settles which bill. Exactly one source: a payment or a debit note.
CREATE TABLE erp.payable_allocations (
  tenant_id        uuid          NOT NULL,
  id               uuid          NOT NULL,
  company_id       uuid          NOT NULL,
  supplier_id      uuid          NOT NULL,
  bill_id          uuid          NOT NULL,
  payment_id       uuid,
  debit_note_id    uuid,
  amount           numeric(18,4) NOT NULL,
  allocated_on     date          NOT NULL,
  reversed_on      date,
  reversed_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id, bill_id) REFERENCES erp.supplier_bills (tenant_id, supplier_id, id),
  FOREIGN KEY (tenant_id, supplier_id, payment_id) REFERENCES erp.supplier_payments (tenant_id, supplier_id, id),
  FOREIGN KEY (tenant_id, supplier_id, debit_note_id) REFERENCES erp.supplier_bills (tenant_id, supplier_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT payable_allocations_amount_positive CHECK (amount > 0),
  CONSTRAINT payable_allocations_one_source CHECK ((payment_id IS NOT NULL) <> (debit_note_id IS NOT NULL)),
  CONSTRAINT payable_allocations_reversal_consistent CHECK ((reversed_at IS NULL) = (reversed_on IS NULL))
);
CREATE INDEX payable_allocations_bill_idx ON erp.payable_allocations (tenant_id, bill_id) WHERE reversed_at IS NULL;
CREATE INDEX payable_allocations_payment_idx ON erp.payable_allocations (tenant_id, payment_id) WHERE reversed_at IS NULL;
CREATE INDEX payable_allocations_note_idx ON erp.payable_allocations (tenant_id, debit_note_id) WHERE reversed_at IS NULL;
CREATE FUNCTION erp.guard_payable_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.reversed_at IS NOT NULL OR NEW.reversed_at IS NULL
     OR (to_jsonb(NEW) - 'reversed_on' - 'reversed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'reversed_on' - 'reversed_at') THEN
    RAISE EXCEPTION 'an allocation can only be reversed once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payable_allocations_guard BEFORE UPDATE OR DELETE ON erp.payable_allocations FOR EACH ROW EXECUTE FUNCTION erp.guard_payable_allocation();

-- Money received back from a supplier (a refund of an advance, or of a debit note's credit): Dr bank / Cr payables.
CREATE TABLE erp.supplier_refunds (
  tenant_id           uuid          NOT NULL,
  id                  uuid          NOT NULL,
  company_id          uuid          NOT NULL,
  refund_no           text          NOT NULL,
  supplier_id         uuid          NOT NULL,
  refund_date         date          NOT NULL,
  amount              numeric(18,4) NOT NULL,
  method              text          NOT NULL,
  deposit_account_id  uuid          NOT NULL,
  payment_id          uuid,
  debit_note_id       uuid,
  reference           text,
  journal_entry_id    uuid          NOT NULL,
  created_by          uuid,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id, payment_id) REFERENCES erp.supplier_payments (tenant_id, supplier_id, id),
  FOREIGN KEY (tenant_id, supplier_id, debit_note_id) REFERENCES erp.supplier_bills (tenant_id, supplier_id, id),
  FOREIGN KEY (tenant_id, company_id, deposit_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT supplier_refunds_no_unique UNIQUE (tenant_id, company_id, refund_no),
  CONSTRAINT supplier_refunds_amount_positive CHECK (amount > 0),
  CONSTRAINT supplier_refunds_method_valid CHECK (method IN ('cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other')),
  CONSTRAINT supplier_refunds_one_source CHECK ((payment_id IS NOT NULL) <> (debit_note_id IS NOT NULL))
);
CREATE INDEX supplier_refunds_payment_idx ON erp.supplier_refunds (tenant_id, payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX supplier_refunds_note_idx ON erp.supplier_refunds (tenant_id, debit_note_id) WHERE debit_note_id IS NOT NULL;
CREATE TRIGGER supplier_refunds_immutable BEFORE UPDATE OR DELETE ON erp.supplier_refunds FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

-- At COMMIT: what is allocated against a bill never exceeds its value, and allocations AND refunds drawn from a payment or debit
-- note never exceed what it holds. (The application checks first and says why; this is the backstop for concurrent requests.)
CREATE FUNCTION erp.check_payable_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  held numeric;
  used numeric;
BEGIN
  SELECT grand_total INTO held FROM erp.supplier_bills WHERE tenant_id = NEW.tenant_id AND id = NEW.bill_id;
  SELECT COALESCE(sum(amount), 0) INTO used FROM erp.payable_allocations WHERE tenant_id = NEW.tenant_id AND bill_id = NEW.bill_id AND reversed_at IS NULL;
  IF used > held THEN RAISE EXCEPTION 'allocations exceed the bill value' USING ERRCODE = '23514'; END IF;
  IF NEW.payment_id IS NOT NULL THEN
    SELECT amount INTO held FROM erp.supplier_payments WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id;
    SELECT COALESCE(sum(amount), 0) INTO used FROM erp.payable_allocations WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id AND reversed_at IS NULL;
    used := used + COALESCE((SELECT sum(amount) FROM erp.supplier_refunds WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id), 0);
    IF used > held THEN RAISE EXCEPTION 'allocations and refunds exceed the payment amount' USING ERRCODE = '23514'; END IF;
  ELSE
    SELECT grand_total INTO held FROM erp.supplier_bills WHERE tenant_id = NEW.tenant_id AND id = NEW.debit_note_id;
    SELECT COALESCE(sum(amount), 0) INTO used FROM erp.payable_allocations WHERE tenant_id = NEW.tenant_id AND debit_note_id = NEW.debit_note_id AND reversed_at IS NULL;
    used := used + COALESCE((SELECT sum(amount) FROM erp.supplier_refunds WHERE tenant_id = NEW.tenant_id AND debit_note_id = NEW.debit_note_id), 0);
    IF used > held THEN RAISE EXCEPTION 'allocations and refunds exceed the debit note value' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER payable_allocations_check AFTER INSERT ON erp.payable_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_payable_allocation();

CREATE FUNCTION erp.check_supplier_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  held numeric;
  used numeric;
BEGIN
  IF NEW.payment_id IS NOT NULL THEN
    SELECT amount INTO held FROM erp.supplier_payments WHERE tenant_id = NEW.tenant_id AND id = NEW.payment_id;
    SELECT COALESCE(sum(amount), 0) INTO used FROM erp.payable_allocations WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id AND reversed_at IS NULL;
    used := used + (SELECT COALESCE(sum(amount), 0) FROM erp.supplier_refunds WHERE tenant_id = NEW.tenant_id AND payment_id = NEW.payment_id);
  ELSE
    SELECT grand_total INTO held FROM erp.supplier_bills WHERE tenant_id = NEW.tenant_id AND id = NEW.debit_note_id;
    SELECT COALESCE(sum(amount), 0) INTO used FROM erp.payable_allocations WHERE tenant_id = NEW.tenant_id AND debit_note_id = NEW.debit_note_id AND reversed_at IS NULL;
    used := used + (SELECT COALESCE(sum(amount), 0) FROM erp.supplier_refunds WHERE tenant_id = NEW.tenant_id AND debit_note_id = NEW.debit_note_id);
  END IF;
  IF used > held THEN RAISE EXCEPTION 'refunds exceed what the source holds' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER supplier_refunds_check AFTER INSERT ON erp.supplier_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_supplier_refund();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_payments', 'payable_allocations', 'supplier_refunds'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.supplier_payments, erp.payable_allocations, erp.supplier_refunds TO erp_app;
GRANT UPDATE (status, cancelled_at, cancel_date, cancel_reason, cancel_journal_entry_id) ON erp.supplier_payments TO erp_app;
GRANT UPDATE (reversed_on, reversed_at) ON erp.payable_allocations TO erp_app;
