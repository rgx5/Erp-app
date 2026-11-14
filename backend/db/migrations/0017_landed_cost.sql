-- Landed cost: freight, duty, insurance and similar charges capitalised into the cost of goods already received.
-- The charges are first booked as ordinary expenses (a supplier bill, a payment); the voucher moves them into inventory by
-- allocating the total over the chosen receipt lines (by value or by quantity), revaluing the stock (StockService.revalue) and
-- relieving the charge accounts. Immutable once posted; cancelling reverses both entries.

CREATE TABLE erp.landed_cost_vouchers (
  tenant_id                 uuid          NOT NULL,
  id                        uuid          NOT NULL,
  company_id                uuid          NOT NULL,
  voucher_no                text          NOT NULL,
  voucher_date              date          NOT NULL,
  description               text          NOT NULL,
  basis                     text          NOT NULL,
  total_amount              numeric(18,4) NOT NULL,
  journal_entry_id          uuid          NOT NULL,
  revaluation_movement_id   uuid,
  status                    text          NOT NULL DEFAULT 'posted',
  cancelled_at              timestamptz,
  cancel_date               date,
  cancel_reason             text,
  cancel_journal_entry_id   uuid,
  created_by                uuid,
  created_at                timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, cancel_journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, revaluation_movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT landed_cost_vouchers_no_unique UNIQUE (tenant_id, company_id, voucher_no),
  CONSTRAINT landed_cost_vouchers_basis_valid CHECK (basis IN ('value', 'quantity')),
  CONSTRAINT landed_cost_vouchers_total_positive CHECK (total_amount > 0),
  CONSTRAINT landed_cost_vouchers_status_valid CHECK (status IN ('posted', 'cancelled')),
  CONSTRAINT landed_cost_vouchers_cancel_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_date IS NOT NULL AND cancel_reason IS NOT NULL))
);

CREATE TABLE erp.landed_cost_charges (
  tenant_id    uuid          NOT NULL,
  id           uuid          NOT NULL,
  voucher_id   uuid          NOT NULL,
  line_no      integer       NOT NULL,
  kind         text          NOT NULL,
  description  text          NOT NULL,
  amount       numeric(18,4) NOT NULL,
  account_id   uuid          NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, voucher_id) REFERENCES erp.landed_cost_vouchers (tenant_id, id),
  CONSTRAINT landed_cost_charges_no_unique UNIQUE (tenant_id, voucher_id, line_no),
  CONSTRAINT landed_cost_charges_kind_valid CHECK (kind IN ('freight', 'customs_duty', 'insurance', 'handling', 'other')),
  CONSTRAINT landed_cost_charges_amount_positive CHECK (amount > 0)
);

CREATE TABLE erp.landed_cost_lines (
  tenant_id     uuid          NOT NULL,
  id            uuid          NOT NULL,
  voucher_id    uuid          NOT NULL,
  line_no       integer       NOT NULL,
  grn_line_id   uuid          NOT NULL,
  item_id       uuid          NOT NULL,
  quantity      numeric(18,6) NOT NULL,
  basis_value   numeric(18,4) NOT NULL,
  allocated     numeric(18,4) NOT NULL,
  capitalised   numeric(18,4) NOT NULL,
  expensed      numeric(18,4) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, voucher_id) REFERENCES erp.landed_cost_vouchers (tenant_id, id),
  FOREIGN KEY (tenant_id, grn_line_id) REFERENCES erp.goods_receipt_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  CONSTRAINT landed_cost_lines_no_unique UNIQUE (tenant_id, voucher_id, line_no),
  CONSTRAINT landed_cost_lines_valid CHECK (quantity > 0 AND allocated >= 0 AND capitalised + expensed = allocated)
);
CREATE INDEX landed_cost_lines_grn_idx ON erp.landed_cost_lines (tenant_id, grn_line_id);

CREATE FUNCTION erp.guard_landed_cost_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'cancelled' OR NEW.status <> 'cancelled'
     OR (to_jsonb(NEW) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id') THEN
    RAISE EXCEPTION 'a landed cost voucher is immutable; it can only be cancelled once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER landed_cost_vouchers_guard BEFORE UPDATE OR DELETE ON erp.landed_cost_vouchers FOR EACH ROW EXECUTE FUNCTION erp.guard_landed_cost_voucher();
CREATE TRIGGER landed_cost_charges_immutable BEFORE UPDATE OR DELETE ON erp.landed_cost_charges FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER landed_cost_lines_immutable BEFORE UPDATE OR DELETE ON erp.landed_cost_lines FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

-- At COMMIT: the charges add up to the total, and so does what was allocated over the receipt lines.
CREATE FUNCTION erp.check_landed_cost_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_charges numeric;
  v_allocated numeric;
  v_lines integer;
BEGIN
  SELECT COALESCE(sum(c.amount), 0) INTO v_charges FROM erp.landed_cost_charges c WHERE c.tenant_id = NEW.tenant_id AND c.voucher_id = NEW.id;
  SELECT COALESCE(sum(l.allocated), 0), count(*) INTO v_allocated, v_lines FROM erp.landed_cost_lines l WHERE l.tenant_id = NEW.tenant_id AND l.voucher_id = NEW.id;
  IF v_lines = 0 OR v_charges <> NEW.total_amount OR v_allocated <> NEW.total_amount THEN
    RAISE EXCEPTION 'landed cost voucher % does not add up: charges %, allocated %, total %', NEW.voucher_no, v_charges, v_allocated, NEW.total_amount USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER landed_cost_vouchers_complete AFTER INSERT ON erp.landed_cost_vouchers DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_landed_cost_complete();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['landed_cost_vouchers', 'landed_cost_charges', 'landed_cost_lines'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.landed_cost_vouchers, erp.landed_cost_charges, erp.landed_cost_lines TO erp_app;
GRANT UPDATE (status, cancelled_at, cancel_date, cancel_reason, cancel_journal_entry_id) ON erp.landed_cost_vouchers TO erp_app;
