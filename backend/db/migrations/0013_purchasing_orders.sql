-- Purchasing, part 1: company purchasing settings, purchase orders and goods receipts (GRN).
-- A receipt moves stock in at the order price and accrues Dr inventory / Cr GRNI (goods received not invoiced) through the
-- inventory subledger; the supplier bill (next migration) clears GRNI. Neither document is editable once posted.

CREATE TABLE erp.purchasing_settings (
  tenant_id                    uuid         NOT NULL,
  company_id                   uuid         NOT NULL,
  payable_account_id           uuid,
  grni_account_id              uuid,
  purchase_price_variance_account_id uuid,
  expense_purchase_account_id  uuid,
  round_off_account_id         uuid,
  input_cgst_account_id        uuid,
  input_sgst_account_id        uuid,
  input_igst_account_id        uuid,
  input_cess_account_id        uuid,
  rcm_cgst_account_id          uuid,
  rcm_sgst_account_id          uuid,
  rcm_igst_account_id          uuid,
  rcm_cess_account_id          uuid,
  freight_account_id           uuid,
  price_tolerance_percent      numeric(7,4) NOT NULL DEFAULT 0,
  quantity_tolerance_percent   numeric(7,4) NOT NULL DEFAULT 0,
  version                      integer      NOT NULL DEFAULT 1,
  created_at                   timestamptz  NOT NULL DEFAULT now(),
  updated_at                   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, payable_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, grni_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, purchase_price_variance_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, expense_purchase_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, round_off_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, input_cgst_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, input_sgst_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, input_igst_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, input_cess_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, rcm_cgst_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, rcm_sgst_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, rcm_igst_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, rcm_cess_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, freight_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  CONSTRAINT purchasing_settings_tolerances CHECK (price_tolerance_percent BETWEEN 0 AND 100 AND quantity_tolerance_percent BETWEEN 0 AND 100)
);
CREATE TRIGGER purchasing_settings_touch BEFORE UPDATE ON erp.purchasing_settings FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

CREATE TABLE erp.purchase_orders (
  tenant_id              uuid        NOT NULL,
  id                     uuid        NOT NULL,
  company_id             uuid        NOT NULL,
  po_no                  text        NOT NULL,
  gst_registration_id    uuid        NOT NULL,
  business_location_id   uuid,
  supplier_id            uuid        NOT NULL,
  order_date             date        NOT NULL,
  expected_date          date,
  supplier_reference     text,
  notes                  text,
  status                 text        NOT NULL DEFAULT 'open',
  closed_at              timestamptz,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, gst_registration_id) REFERENCES erp.gst_registrations (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT purchase_orders_no_unique UNIQUE (tenant_id, company_id, po_no),
  CONSTRAINT purchase_orders_status_valid CHECK (status IN ('open', 'partially_received', 'received', 'closed', 'cancelled')),
  CONSTRAINT purchase_orders_dates CHECK (expected_date IS NULL OR expected_date >= order_date)
);

CREATE TABLE erp.purchase_order_lines (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  order_id           uuid          NOT NULL,
  line_no            integer       NOT NULL,
  item_id            uuid          NOT NULL,
  description        text          NOT NULL,
  quantity           numeric(18,6) NOT NULL,
  quantity_received  numeric(18,6) NOT NULL DEFAULT 0,
  quantity_billed    numeric(18,6) NOT NULL DEFAULT 0,
  unit_price         numeric(18,4) NOT NULL,
  discount_percent   numeric(7,4)  NOT NULL DEFAULT 0,
  tax_code_id        uuid,
  warehouse_id       uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES erp.purchase_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, tax_code_id) REFERENCES erp.tax_codes (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  CONSTRAINT purchase_order_lines_no_unique UNIQUE (tenant_id, order_id, line_no),
  CONSTRAINT purchase_order_lines_valid CHECK (quantity > 0 AND unit_price >= 0 AND discount_percent BETWEEN 0 AND 100),
  CONSTRAINT purchase_order_lines_received_range CHECK (quantity_received >= 0 AND quantity_received <= quantity),
  -- billing may run past the order by the company tolerance (checked by the service), so it is only bounded below here
  CONSTRAINT purchase_order_lines_billed_range CHECK (quantity_billed >= 0)
);

CREATE TABLE erp.goods_receipts (
  tenant_id              uuid        NOT NULL,
  id                     uuid        NOT NULL,
  company_id             uuid        NOT NULL,
  grn_no                 text        NOT NULL,
  purchase_order_id      uuid,
  supplier_id            uuid        NOT NULL,
  receipt_date           date        NOT NULL,
  supplier_delivery_note text,
  notes                  text,
  stock_movement_id      uuid        NOT NULL,
  status                 text        NOT NULL DEFAULT 'posted',
  received_by            uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES erp.purchase_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, stock_movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, received_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT goods_receipts_no_unique UNIQUE (tenant_id, company_id, grn_no),
  CONSTRAINT goods_receipts_status_valid CHECK (status IN ('posted'))
);

CREATE TABLE erp.goods_receipt_lines (
  tenant_id           uuid          NOT NULL,
  id                  uuid          NOT NULL,
  receipt_id          uuid          NOT NULL,
  line_no             integer       NOT NULL,
  order_line_id       uuid,
  item_id             uuid          NOT NULL,
  warehouse_id        uuid          NOT NULL,
  quantity            numeric(18,6) NOT NULL,
  quantity_billed     numeric(18,6) NOT NULL DEFAULT 0,
  quantity_returned   numeric(18,6) NOT NULL DEFAULT 0,
  unit_cost           numeric(18,6) NOT NULL,
  value               numeric(18,4) NOT NULL,
  batch_id            uuid,
  serial_nos          text[],
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES erp.goods_receipts (tenant_id, id),
  FOREIGN KEY (tenant_id, order_line_id) REFERENCES erp.purchase_order_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id, batch_id) REFERENCES erp.batches (tenant_id, item_id, id),
  CONSTRAINT goods_receipt_lines_no_unique UNIQUE (tenant_id, receipt_id, line_no),
  CONSTRAINT goods_receipt_lines_valid CHECK (quantity > 0 AND unit_cost >= 0 AND value >= 0),
  CONSTRAINT goods_receipt_lines_billed_range CHECK (quantity_billed >= 0 AND quantity_returned >= 0 AND quantity_billed <= quantity AND quantity_returned <= quantity)
);
CREATE INDEX goods_receipts_order_idx ON erp.goods_receipts (tenant_id, purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX goods_receipt_lines_order_line_idx ON erp.goods_receipt_lines (tenant_id, order_line_id) WHERE order_line_id IS NOT NULL;

-- A purchase order never changes once placed except its status; its lines only move the received / billed quantities.
CREATE FUNCTION erp.guard_purchase_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status IN ('closed', 'cancelled') OR (to_jsonb(NEW) - 'status' - 'closed_at' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'closed_at' - 'updated_at') THEN
    RAISE EXCEPTION 'a purchase order can only change status, and not once it is closed or cancelled' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_orders_guard BEFORE UPDATE OR DELETE ON erp.purchase_orders FOR EACH ROW EXECUTE FUNCTION erp.guard_purchase_order();

CREATE FUNCTION erp.guard_purchase_order_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'quantity_received' - 'quantity_billed') IS DISTINCT FROM (to_jsonb(OLD) - 'quantity_received' - 'quantity_billed') THEN
    RAISE EXCEPTION 'an order line is fixed once placed; only the received and billed quantities move' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER purchase_order_lines_guard BEFORE UPDATE OR DELETE ON erp.purchase_order_lines FOR EACH ROW EXECUTE FUNCTION erp.guard_purchase_order_line();

CREATE TRIGGER goods_receipts_immutable BEFORE UPDATE OR DELETE ON erp.goods_receipts FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE FUNCTION erp.guard_goods_receipt_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'quantity_billed' - 'quantity_returned') IS DISTINCT FROM (to_jsonb(OLD) - 'quantity_billed' - 'quantity_returned') THEN
    RAISE EXCEPTION 'a goods receipt line is permanent; only the billed and returned quantities move' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER goods_receipt_lines_guard BEFORE UPDATE OR DELETE ON erp.goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION erp.guard_goods_receipt_line();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchasing_settings', 'purchase_orders', 'purchase_order_lines', 'goods_receipts', 'goods_receipt_lines'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.purchase_orders, erp.purchase_order_lines, erp.goods_receipts, erp.goods_receipt_lines TO erp_app;
GRANT SELECT, INSERT, UPDATE ON erp.purchasing_settings TO erp_app;
GRANT UPDATE (status, closed_at, updated_at) ON erp.purchase_orders TO erp_app;
GRANT UPDATE (quantity_received, quantity_billed) ON erp.purchase_order_lines TO erp_app;
GRANT UPDATE (quantity_billed, quantity_returned) ON erp.goods_receipt_lines TO erp_app;
