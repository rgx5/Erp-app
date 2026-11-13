-- Quotes and sales orders. Neither touches the ledgers. An order may reserve stock (Slice 4 reservations) and is invoiced, in
-- whole or in parts, through the normal invoice posting; invoices remember the order they came from.

CREATE TABLE erp.sales_quotes (
  tenant_id              uuid          NOT NULL,
  id                     uuid          NOT NULL,
  company_id             uuid          NOT NULL,
  quote_no               text          NOT NULL,
  gst_registration_id    uuid          NOT NULL,
  business_location_id   uuid,
  customer_id            uuid          NOT NULL,
  quote_date             date          NOT NULL,
  valid_until            date          NOT NULL,
  bill_to_address_id     uuid,
  ship_to_address_id     uuid,
  place_of_supply_state  char(2),
  reverse_charge         boolean       NOT NULL DEFAULT false,
  tax_payment            text,
  notes                  text,
  estimated_taxable      numeric(18,4) NOT NULL,
  estimated_tax          numeric(18,4) NOT NULL,
  estimated_total        numeric(18,4) NOT NULL,
  status                 text          NOT NULL DEFAULT 'open',
  order_id               uuid,
  created_by             uuid,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, gst_registration_id) REFERENCES erp.gst_registrations (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT sales_quotes_no_unique UNIQUE (tenant_id, company_id, quote_no),
  CONSTRAINT sales_quotes_status_valid CHECK (status IN ('open', 'rejected', 'converted')),
  CONSTRAINT sales_quotes_validity CHECK (valid_until >= quote_date),
  CONSTRAINT sales_quotes_converted_link CHECK ((status = 'converted') = (order_id IS NOT NULL))
);

CREATE TABLE erp.sales_quote_lines (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  quote_id           uuid          NOT NULL,
  line_no            integer       NOT NULL,
  item_id            uuid          NOT NULL,
  description        text          NOT NULL,
  quantity           numeric(18,6) NOT NULL,
  unit_price         numeric(18,4) NOT NULL,
  discount_percent   numeric(7,4)  NOT NULL DEFAULT 0,
  tax_inclusive      boolean       NOT NULL DEFAULT false,
  tax_code_id        uuid,
  warehouse_id       uuid,
  estimated_taxable  numeric(18,4) NOT NULL,
  estimated_total    numeric(18,4) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES erp.sales_quotes (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, tax_code_id) REFERENCES erp.tax_codes (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  CONSTRAINT sales_quote_lines_no_unique UNIQUE (tenant_id, quote_id, line_no),
  CONSTRAINT sales_quote_lines_valid CHECK (quantity > 0 AND unit_price >= 0 AND discount_percent BETWEEN 0 AND 100)
);

CREATE TABLE erp.sales_orders (
  tenant_id              uuid        NOT NULL,
  id                     uuid        NOT NULL,
  company_id             uuid        NOT NULL,
  order_no               text        NOT NULL,
  gst_registration_id    uuid        NOT NULL,
  business_location_id   uuid,
  customer_id            uuid        NOT NULL,
  order_date             date        NOT NULL,
  customer_reference     text,
  bill_to_address_id     uuid,
  ship_to_address_id     uuid,
  place_of_supply_state  char(2),
  reverse_charge         boolean     NOT NULL DEFAULT false,
  tax_payment            text,
  document_type          text        NOT NULL DEFAULT 'tax_invoice',
  reserve_stock          boolean     NOT NULL DEFAULT false,
  quote_id               uuid,
  status                 text        NOT NULL DEFAULT 'open',
  closed_at              timestamptz,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, gst_registration_id) REFERENCES erp.gst_registrations (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES erp.sales_quotes (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT sales_orders_no_unique UNIQUE (tenant_id, company_id, order_no),
  CONSTRAINT sales_orders_type_valid CHECK (document_type IN ('tax_invoice', 'bill_of_supply')),
  CONSTRAINT sales_orders_status_valid CHECK (status IN ('open', 'partially_invoiced', 'invoiced', 'closed', 'cancelled'))
);
ALTER TABLE erp.sales_quotes ADD FOREIGN KEY (tenant_id, order_id) REFERENCES erp.sales_orders (tenant_id, id);

CREATE TABLE erp.sales_order_lines (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  order_id           uuid          NOT NULL,
  line_no            integer       NOT NULL,
  item_id            uuid          NOT NULL,
  description        text          NOT NULL,
  quantity           numeric(18,6) NOT NULL,
  quantity_invoiced  numeric(18,6) NOT NULL DEFAULT 0,
  unit_price         numeric(18,4) NOT NULL,
  discount_percent   numeric(7,4)  NOT NULL DEFAULT 0,
  tax_inclusive      boolean       NOT NULL DEFAULT false,
  tax_code_id        uuid,
  warehouse_id       uuid,
  batch_id           uuid,
  reservation_id     uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES erp.sales_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, tax_code_id) REFERENCES erp.tax_codes (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id, batch_id) REFERENCES erp.batches (tenant_id, item_id, id),
  FOREIGN KEY (tenant_id, reservation_id) REFERENCES erp.stock_reservations (tenant_id, id),
  CONSTRAINT sales_order_lines_no_unique UNIQUE (tenant_id, order_id, line_no),
  CONSTRAINT sales_order_lines_valid CHECK (quantity > 0 AND unit_price >= 0 AND discount_percent BETWEEN 0 AND 100),
  CONSTRAINT sales_order_lines_invoiced_range CHECK (quantity_invoiced >= 0 AND quantity_invoiced <= quantity)
);

-- Invoices remember the order (and line) they were raised from.
ALTER TABLE erp.sales_invoices ADD COLUMN order_id uuid;
ALTER TABLE erp.sales_invoices ADD FOREIGN KEY (tenant_id, order_id) REFERENCES erp.sales_orders (tenant_id, id);
ALTER TABLE erp.sales_invoice_lines ADD COLUMN order_line_id uuid;
ALTER TABLE erp.sales_invoice_lines ADD FOREIGN KEY (tenant_id, order_line_id) REFERENCES erp.sales_order_lines (tenant_id, id);
CREATE INDEX sales_invoices_order_idx ON erp.sales_invoices (tenant_id, order_id) WHERE order_id IS NOT NULL;

-- What may change: a quote its status (and the order it became), an order its status, an order line only how much was invoiced.
CREATE FUNCTION erp.guard_sales_quote() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'open' OR (to_jsonb(NEW) - 'status' - 'order_id' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'order_id' - 'updated_at') THEN
    RAISE EXCEPTION 'a quote can only be rejected or converted, once' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER sales_quotes_guard BEFORE UPDATE OR DELETE ON erp.sales_quotes FOR EACH ROW EXECUTE FUNCTION erp.guard_sales_quote();
CREATE TRIGGER sales_quote_lines_immutable BEFORE UPDATE OR DELETE ON erp.sales_quote_lines FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

CREATE FUNCTION erp.guard_sales_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status IN ('closed', 'cancelled') OR (to_jsonb(NEW) - 'status' - 'closed_at' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'closed_at' - 'updated_at') THEN
    RAISE EXCEPTION 'a sales order can only change status, and not once it is closed or cancelled' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER sales_orders_guard BEFORE UPDATE OR DELETE ON erp.sales_orders FOR EACH ROW EXECUTE FUNCTION erp.guard_sales_order();

CREATE FUNCTION erp.guard_sales_order_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'quantity_invoiced') IS DISTINCT FROM (to_jsonb(OLD) - 'quantity_invoiced') THEN
    RAISE EXCEPTION 'an order line is fixed once placed; only the invoiced quantity moves' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sales_order_lines_guard BEFORE UPDATE OR DELETE ON erp.sales_order_lines FOR EACH ROW EXECUTE FUNCTION erp.guard_sales_order_line();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_quotes', 'sales_quote_lines', 'sales_orders', 'sales_order_lines'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.sales_quotes, erp.sales_quote_lines, erp.sales_orders, erp.sales_order_lines TO erp_app;
GRANT UPDATE (status, order_id, updated_at) ON erp.sales_quotes TO erp_app;
GRANT UPDATE (status, closed_at, updated_at) ON erp.sales_orders TO erp_app;
GRANT UPDATE (quantity_invoiced) ON erp.sales_order_lines TO erp_app;
