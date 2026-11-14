-- Purchasing, part 2: supplier bills (with GST input credit and three-way match), debit notes for returns, and returns of goods
-- received but not yet billed. A bill is immutable once posted; it can only be cancelled (its journal reversed, its quantities
-- given back). The GRNI account is cleared by the bill and the difference to the bill's price goes to purchase price variance.

ALTER TABLE erp.goods_receipt_lines ADD COLUMN value_billed numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE erp.goods_receipt_lines ADD COLUMN value_returned numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE erp.goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_open_range CHECK (quantity_billed + quantity_returned <= quantity AND value_billed >= 0 AND value_returned >= 0 AND value_billed + value_returned <= value);
CREATE OR REPLACE FUNCTION erp.guard_goods_receipt_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'quantity_billed' - 'quantity_returned' - 'value_billed' - 'value_returned') IS DISTINCT FROM (to_jsonb(OLD) - 'quantity_billed' - 'quantity_returned' - 'value_billed' - 'value_returned') THEN
    RAISE EXCEPTION 'a goods receipt line is permanent; only the billed and returned quantities and values move' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
GRANT UPDATE (value_billed, value_returned) ON erp.goods_receipt_lines TO erp_app;

CREATE TABLE erp.supplier_bills (
  tenant_id               uuid          NOT NULL,
  id                      uuid          NOT NULL,
  company_id              uuid          NOT NULL,
  document_type           text          NOT NULL,
  bill_no                 text          NOT NULL,
  supplier_invoice_no     text          NOT NULL,
  supplier_invoice_date   date          NOT NULL,
  bill_date               date          NOT NULL,
  due_date                date          NOT NULL,
  gst_registration_id     uuid          NOT NULL,
  business_location_id    uuid,
  supplier_id             uuid          NOT NULL,
  supplier_name           text          NOT NULL,
  supplier_gstin          char(15),
  supplier_gst_treatment  text          NOT NULL,
  supplier_state          char(2)       NOT NULL,
  place_of_supply         char(2)       NOT NULL,
  tax_regime              text          NOT NULL,
  reverse_charge          boolean       NOT NULL DEFAULT false,
  taxable_total           numeric(18,4) NOT NULL,
  cgst_total              numeric(18,4) NOT NULL DEFAULT 0,
  sgst_total              numeric(18,4) NOT NULL DEFAULT 0,
  igst_total              numeric(18,4) NOT NULL DEFAULT 0,
  cess_total              numeric(18,4) NOT NULL DEFAULT 0,
  itc_total               numeric(18,4) NOT NULL DEFAULT 0,
  round_off               numeric(18,4) NOT NULL DEFAULT 0,
  grand_total             numeric(18,4) NOT NULL,
  original_bill_id        uuid,
  reason                  text,
  match_status            text          NOT NULL,
  match_issues            jsonb,
  match_override_by       uuid,
  match_override_reason   text,
  match_override_at       timestamptz,
  journal_entry_id        uuid,
  stock_movement_id       uuid,
  revaluation_movement_id uuid,
  status                  text          NOT NULL DEFAULT 'posted',
  cancelled_at            timestamptz,
  cancel_date             date,
  cancel_reason           text,
  cancel_journal_entry_id uuid,
  posted_by               uuid,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, gst_registration_id) REFERENCES erp.gst_registrations (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, original_bill_id) REFERENCES erp.supplier_bills (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, cancel_journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, stock_movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, revaluation_movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, match_override_by) REFERENCES erp.users (tenant_id, id),
  FOREIGN KEY (tenant_id, posted_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT supplier_bills_no_unique UNIQUE (tenant_id, company_id, bill_no),
  CONSTRAINT supplier_bills_type_valid CHECK (document_type IN ('bill', 'debit_note')),
  CONSTRAINT supplier_bills_status_valid CHECK (status IN ('posted', 'cancelled')),
  CONSTRAINT supplier_bills_regime_valid CHECK (tax_regime IN ('intra', 'inter')),
  CONSTRAINT supplier_bills_match_valid CHECK (match_status IN ('matched', 'unmatched', 'overridden', 'not_applicable')),
  CONSTRAINT supplier_bills_override_complete CHECK ((match_status = 'overridden') = (match_override_by IS NOT NULL AND match_override_reason IS NOT NULL AND match_override_at IS NOT NULL)),
  CONSTRAINT supplier_bills_note_link CHECK ((document_type = 'debit_note') = (original_bill_id IS NOT NULL)),
  CONSTRAINT supplier_bills_dates CHECK (due_date >= bill_date),
  CONSTRAINT supplier_bills_cancel_complete CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
-- One live bill per supplier invoice number (a cancelled bill frees the number so the invoice can be booked again).
CREATE UNIQUE INDEX supplier_bills_supplier_invoice_unique ON erp.supplier_bills (tenant_id, company_id, supplier_id, lower(supplier_invoice_no)) WHERE document_type = 'bill' AND status = 'posted';
CREATE INDEX supplier_bills_supplier_idx ON erp.supplier_bills (tenant_id, company_id, supplier_id, bill_date, id);
CREATE INDEX supplier_bills_original_idx ON erp.supplier_bills (tenant_id, original_bill_id) WHERE original_bill_id IS NOT NULL;

CREATE TABLE erp.supplier_bill_lines (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  bill_id            uuid          NOT NULL,
  line_no            integer       NOT NULL,
  item_id            uuid          NOT NULL,
  description        text          NOT NULL,
  hsn_sac_code       text,
  quantity           numeric(18,6) NOT NULL,
  unit_price         numeric(18,4) NOT NULL,
  discount_percent   numeric(7,4)  NOT NULL DEFAULT 0,
  tax_inclusive      boolean       NOT NULL DEFAULT false,
  tax_code_id        uuid,
  igst_rate          numeric(7,4)  NOT NULL DEFAULT 0,
  cgst_rate          numeric(7,4)  NOT NULL DEFAULT 0,
  sgst_rate          numeric(7,4)  NOT NULL DEFAULT 0,
  cess_rate          numeric(7,4)  NOT NULL DEFAULT 0,
  taxable_value      numeric(18,4) NOT NULL,
  cgst_amount        numeric(18,4) NOT NULL DEFAULT 0,
  sgst_amount        numeric(18,4) NOT NULL DEFAULT 0,
  igst_amount        numeric(18,4) NOT NULL DEFAULT 0,
  cess_amount        numeric(18,4) NOT NULL DEFAULT 0,
  line_total         numeric(18,4) NOT NULL,
  itc_eligible       boolean       NOT NULL DEFAULT true,
  po_line_id         uuid,
  grn_line_id        uuid,
  expense_account_id uuid,
  cleared_quantity   numeric(18,6) NOT NULL DEFAULT 0,
  cleared_value      numeric(18,4) NOT NULL DEFAULT 0,
  price_variance     numeric(18,4) NOT NULL DEFAULT 0,
  capitalised_tax    numeric(18,4) NOT NULL DEFAULT 0,
  original_line_id   uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, bill_id) REFERENCES erp.supplier_bills (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, tax_code_id) REFERENCES erp.tax_codes (tenant_id, id),
  FOREIGN KEY (tenant_id, po_line_id) REFERENCES erp.purchase_order_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, grn_line_id) REFERENCES erp.goods_receipt_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, original_line_id) REFERENCES erp.supplier_bill_lines (tenant_id, id),
  CONSTRAINT supplier_bill_lines_no_unique UNIQUE (tenant_id, bill_id, line_no),
  CONSTRAINT supplier_bill_lines_valid CHECK (quantity > 0 AND unit_price >= 0 AND discount_percent BETWEEN 0 AND 100 AND cleared_quantity >= 0 AND cleared_quantity <= quantity)
);
CREATE INDEX supplier_bill_lines_grn_idx ON erp.supplier_bill_lines (tenant_id, grn_line_id) WHERE grn_line_id IS NOT NULL;
CREATE INDEX supplier_bill_lines_po_idx ON erp.supplier_bill_lines (tenant_id, po_line_id) WHERE po_line_id IS NOT NULL;

-- Returns of goods received but not yet billed (nothing to debit the supplier for yet: stock out, GRNI cleared at the receipt value).
CREATE TABLE erp.receipt_returns (
  tenant_id          uuid        NOT NULL,
  id                 uuid        NOT NULL,
  company_id         uuid        NOT NULL,
  return_no          text        NOT NULL,
  receipt_id         uuid        NOT NULL,
  return_date        date        NOT NULL,
  reason             text        NOT NULL,
  stock_movement_id  uuid        NOT NULL,
  journal_entry_id   uuid,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES erp.goods_receipts (tenant_id, id),
  FOREIGN KEY (tenant_id, stock_movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT receipt_returns_no_unique UNIQUE (tenant_id, company_id, return_no)
);
CREATE TABLE erp.receipt_return_lines (
  tenant_id        uuid          NOT NULL,
  id               uuid          NOT NULL,
  return_id        uuid          NOT NULL,
  line_no          integer       NOT NULL,
  receipt_line_id  uuid          NOT NULL,
  quantity         numeric(18,6) NOT NULL,
  receipt_value    numeric(18,4) NOT NULL,
  issue_value      numeric(18,4) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, return_id) REFERENCES erp.receipt_returns (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_line_id) REFERENCES erp.goods_receipt_lines (tenant_id, id),
  CONSTRAINT receipt_return_lines_no_unique UNIQUE (tenant_id, return_id, line_no),
  CONSTRAINT receipt_return_lines_valid CHECK (quantity > 0 AND receipt_value >= 0 AND issue_value >= 0)
);

-- A bill is immutable except for being cancelled, once.
CREATE FUNCTION erp.guard_supplier_bill() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'cancelled' OR NEW.status <> 'cancelled'
     OR (to_jsonb(NEW) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id') THEN
    RAISE EXCEPTION 'a supplier bill is immutable; it can only be cancelled once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER supplier_bills_guard BEFORE UPDATE OR DELETE ON erp.supplier_bills FOR EACH ROW EXECUTE FUNCTION erp.guard_supplier_bill();
CREATE TRIGGER supplier_bill_lines_immutable BEFORE UPDATE OR DELETE ON erp.supplier_bill_lines FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER receipt_returns_immutable BEFORE UPDATE OR DELETE ON erp.receipt_returns FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER receipt_return_lines_immutable BEFORE UPDATE OR DELETE ON erp.receipt_return_lines FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

-- At COMMIT: the header's totals are exactly the sum of its lines.
CREATE FUNCTION erp.check_supplier_bill_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  SELECT count(*) AS n, COALESCE(sum(taxable_value), 0) AS t, COALESCE(sum(cgst_amount), 0) AS c, COALESCE(sum(sgst_amount), 0) AS sg,
         COALESCE(sum(igst_amount), 0) AS i, COALESCE(sum(cess_amount), 0) AS ce,
         COALESCE(sum(cgst_amount + sgst_amount + igst_amount + cess_amount) FILTER (WHERE itc_eligible), 0) AS itc
    INTO s FROM erp.supplier_bill_lines WHERE tenant_id = NEW.tenant_id AND bill_id = NEW.id;
  IF s.n = 0 OR s.t <> NEW.taxable_total OR s.c <> NEW.cgst_total OR s.sg <> NEW.sgst_total OR s.i <> NEW.igst_total OR s.ce <> NEW.cess_total OR s.itc <> NEW.itc_total THEN
    RAISE EXCEPTION 'supplier bill % does not equal the sum of its lines', NEW.bill_no USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER supplier_bills_complete AFTER INSERT ON erp.supplier_bills DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_supplier_bill_complete();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_bills', 'supplier_bill_lines', 'receipt_returns', 'receipt_return_lines'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.supplier_bills, erp.supplier_bill_lines, erp.receipt_returns, erp.receipt_return_lines TO erp_app;
GRANT UPDATE (status, cancelled_at, cancel_date, cancel_reason, cancel_journal_entry_id) ON erp.supplier_bills TO erp_app;
