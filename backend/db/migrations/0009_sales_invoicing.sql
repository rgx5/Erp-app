-- Sales invoicing: tax invoices, bills of supply, credit notes and debit notes with GST, posted atomically to stock and the GL.
-- A posted document is immutable. The only change it can ever undergo is cancellation (status), which keeps its number.
-- The database re-checks the arithmetic the application did: the header totals are the sum of the lines, the tax split matches
-- the regime (CGST+SGST within a state, IGST between states), and the grand total reconciles.

CREATE TABLE erp.sales_settings (
  tenant_id                 uuid        NOT NULL,
  company_id                uuid        NOT NULL,
  receivable_account_id     uuid,
  sales_account_id          uuid,
  service_sales_account_id  uuid,
  cogs_account_id           uuid,
  round_off_account_id      uuid,
  output_cgst_account_id    uuid,
  output_sgst_account_id    uuid,
  output_igst_account_id    uuid,
  output_cess_account_id    uuid,
  version                   integer     NOT NULL DEFAULT 1,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, receivable_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, sales_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, service_sales_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, cogs_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, round_off_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, output_cgst_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, output_sgst_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, output_igst_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, output_cess_account_id) REFERENCES erp.accounts (tenant_id, company_id, id)
);
CREATE TRIGGER sales_settings_touch BEFORE UPDATE ON erp.sales_settings FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

CREATE TABLE erp.sales_invoices (
  tenant_id               uuid          NOT NULL,
  id                      uuid          NOT NULL,
  company_id              uuid          NOT NULL,
  gst_registration_id     uuid          NOT NULL,
  business_location_id    uuid,
  document_type           text          NOT NULL,
  invoice_no              text          NOT NULL,
  invoice_date            date          NOT NULL,
  customer_id             uuid          NOT NULL,
  customer_name           text          NOT NULL,
  customer_gstin          char(15),
  customer_gst_treatment  text          NOT NULL,
  place_of_supply         char(2)       NOT NULL,
  supply_type             text          NOT NULL,
  tax_payment             text,
  reverse_charge          boolean       NOT NULL DEFAULT false,
  tax_regime              text          NOT NULL,
  taxable_total           numeric(18,4) NOT NULL,
  cgst_total              numeric(18,4) NOT NULL DEFAULT 0,
  sgst_total              numeric(18,4) NOT NULL DEFAULT 0,
  igst_total              numeric(18,4) NOT NULL DEFAULT 0,
  cess_total              numeric(18,4) NOT NULL DEFAULT 0,
  round_off               numeric(18,4) NOT NULL DEFAULT 0,
  grand_total             numeric(18,4) NOT NULL,
  original_invoice_id     uuid,
  reason                  text,
  journal_entry_id        uuid,
  stock_movement_id       uuid,
  status                  text          NOT NULL DEFAULT 'posted',
  cancelled_at            timestamptz,
  cancel_date             date,
  cancel_reason           text,
  cancel_journal_entry_id uuid,
  cancel_movement_id      uuid,
  -- Reserved for e-invoicing / e-way bill (no portal integration yet): nothing reads or writes these.
  irn                     text,
  irn_date                timestamptz,
  e_way_bill_no           text,
  posted_by               uuid,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, gst_registration_id) REFERENCES erp.gst_registrations (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, business_location_id) REFERENCES erp.business_locations (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, original_invoice_id) REFERENCES erp.sales_invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, stock_movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, cancel_journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, cancel_movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, posted_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT sales_invoices_number_unique UNIQUE (tenant_id, gst_registration_id, document_type, invoice_no),
  CONSTRAINT sales_invoices_type_valid CHECK (document_type IN ('tax_invoice', 'bill_of_supply', 'credit_note', 'debit_note')),
  CONSTRAINT sales_invoices_supply_valid CHECK (supply_type IN ('b2b', 'b2c', 'sez', 'export')),
  CONSTRAINT sales_invoices_tax_payment_valid CHECK ((tax_payment IS NOT NULL) = (supply_type IN ('sez', 'export')) AND (tax_payment IS NULL OR tax_payment IN ('with_payment', 'without_payment'))),
  CONSTRAINT sales_invoices_regime_valid CHECK (tax_regime IN ('intra', 'inter')),
  CONSTRAINT sales_invoices_pos_format CHECK (place_of_supply ~ '^[0-9]{2}$'),
  CONSTRAINT sales_invoices_split CHECK ((tax_regime = 'intra' AND igst_total = 0) OR (tax_regime = 'inter' AND cgst_total = 0 AND sgst_total = 0)),
  CONSTRAINT sales_invoices_cgst_sgst_equal CHECK (cgst_total = sgst_total),
  CONSTRAINT sales_invoices_totals CHECK (grand_total = taxable_total + CASE WHEN reverse_charge THEN 0 ELSE cgst_total + sgst_total + igst_total + cess_total END + round_off),
  CONSTRAINT sales_invoices_round_off_bounded CHECK (round_off BETWEEN -0.5 AND 0.5),
  CONSTRAINT sales_invoices_amounts_nonneg CHECK (taxable_total >= 0 AND cgst_total >= 0 AND sgst_total >= 0 AND igst_total >= 0 AND cess_total >= 0 AND grand_total >= 0),
  CONSTRAINT sales_invoices_note_shape CHECK ((document_type IN ('credit_note', 'debit_note')) = (original_invoice_id IS NOT NULL AND reason IS NOT NULL)),
  CONSTRAINT sales_invoices_status_valid CHECK (status IN ('posted', 'cancelled')),
  CONSTRAINT sales_invoices_cancel_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND cancel_date IS NOT NULL))
);
CREATE INDEX sales_invoices_customer_idx ON erp.sales_invoices (tenant_id, customer_id, invoice_date);
CREATE INDEX sales_invoices_date_idx ON erp.sales_invoices (tenant_id, company_id, invoice_date, id);
CREATE INDEX sales_invoices_original_idx ON erp.sales_invoices (tenant_id, original_invoice_id);

CREATE TABLE erp.sales_invoice_lines (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  invoice_id         uuid          NOT NULL,
  line_no            integer       NOT NULL,
  item_id            uuid          NOT NULL,
  original_line_id   uuid,
  description        text          NOT NULL,
  hsn_sac_code       text,
  quantity           numeric(18,6) NOT NULL,
  unit_price         numeric(18,4) NOT NULL,
  discount_percent   numeric(7,4)  NOT NULL DEFAULT 0,
  tax_inclusive      boolean       NOT NULL DEFAULT false,
  taxable_value      numeric(18,4) NOT NULL,
  tax_code_id        uuid,
  igst_rate          numeric(7,4)  NOT NULL DEFAULT 0,
  cgst_rate          numeric(7,4)  NOT NULL DEFAULT 0,
  sgst_rate          numeric(7,4)  NOT NULL DEFAULT 0,
  cess_rate          numeric(7,4)  NOT NULL DEFAULT 0,
  cgst_amount        numeric(18,4) NOT NULL DEFAULT 0,
  sgst_amount        numeric(18,4) NOT NULL DEFAULT 0,
  igst_amount        numeric(18,4) NOT NULL DEFAULT 0,
  cess_amount        numeric(18,4) NOT NULL DEFAULT 0,
  line_total         numeric(18,4) NOT NULL,
  warehouse_id       uuid,
  batch_id           uuid,
  serial_nos         text[],
  unit_cost          numeric(18,6),
  cost_value         numeric(18,4),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES erp.sales_invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, original_line_id) REFERENCES erp.sales_invoice_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, tax_code_id) REFERENCES erp.tax_codes (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id, batch_id) REFERENCES erp.batches (tenant_id, item_id, id),
  CONSTRAINT sales_invoice_lines_no_unique UNIQUE (tenant_id, invoice_id, line_no),
  CONSTRAINT sales_invoice_lines_qty_valid CHECK (quantity > 0),
  CONSTRAINT sales_invoice_lines_price_valid CHECK (unit_price >= 0 AND discount_percent BETWEEN 0 AND 100),
  CONSTRAINT sales_invoice_lines_amounts_nonneg CHECK (taxable_value >= 0 AND cgst_amount >= 0 AND sgst_amount >= 0 AND igst_amount >= 0 AND cess_amount >= 0),
  CONSTRAINT sales_invoice_lines_total CHECK (line_total = taxable_value + cgst_amount + sgst_amount + igst_amount + cess_amount),
  CONSTRAINT sales_invoice_lines_cgst_sgst_equal CHECK (cgst_amount = sgst_amount AND cgst_rate = sgst_rate),
  CONSTRAINT sales_invoice_lines_not_both CHECK (igst_amount = 0 OR (cgst_amount = 0 AND sgst_amount = 0))
);
CREATE INDEX sales_invoice_lines_item_idx ON erp.sales_invoice_lines (tenant_id, item_id);
CREATE INDEX sales_invoice_lines_original_idx ON erp.sales_invoice_lines (tenant_id, original_line_id);

-- Lines are immutable. The header can only be cancelled (status + cancellation facts), never edited.
CREATE FUNCTION erp.guard_sales_invoice() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR OLD.status = 'cancelled'
     OR NEW.status <> 'cancelled'
     OR (to_jsonb(NEW) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id' - 'cancel_movement_id')
        IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancelled_at' - 'cancel_date' - 'cancel_reason' - 'cancel_journal_entry_id' - 'cancel_movement_id') THEN
    RAISE EXCEPTION 'a sales document is immutable; it can only be cancelled once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_invoices_guard BEFORE UPDATE OR DELETE ON erp.sales_invoices FOR EACH ROW EXECUTE FUNCTION erp.guard_sales_invoice();
CREATE TRIGGER sales_invoice_lines_immutable BEFORE UPDATE OR DELETE ON erp.sales_invoice_lines FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

-- At COMMIT: the header's totals are exactly the sum of its lines.
CREATE FUNCTION erp.check_sales_invoice_complete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  s record;
BEGIN
  SELECT count(*) AS n, COALESCE(sum(taxable_value), 0) AS t, COALESCE(sum(cgst_amount), 0) AS c, COALESCE(sum(sgst_amount), 0) AS sg,
         COALESCE(sum(igst_amount), 0) AS i, COALESCE(sum(cess_amount), 0) AS ce
    INTO s FROM erp.sales_invoice_lines WHERE tenant_id = NEW.tenant_id AND invoice_id = NEW.id;
  IF s.n = 0 OR s.t <> NEW.taxable_total OR s.c <> NEW.cgst_total OR s.sg <> NEW.sgst_total OR s.i <> NEW.igst_total OR s.ce <> NEW.cess_total THEN
    RAISE EXCEPTION 'sales document % does not equal the sum of its lines', NEW.invoice_no USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER sales_invoices_complete AFTER INSERT ON erp.sales_invoices DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_sales_invoice_complete();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_settings', 'sales_invoices', 'sales_invoice_lines'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.sales_settings TO erp_app;
GRANT SELECT, INSERT ON erp.sales_invoices, erp.sales_invoice_lines TO erp_app;
GRANT UPDATE (status, cancelled_at, cancel_date, cancel_reason, cancel_journal_entry_id, cancel_movement_id) ON erp.sales_invoices TO erp_app;
