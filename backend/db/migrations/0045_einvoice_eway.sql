-- E-invoice and e-way bill records. The software prepares the files; the government portals issue the numbers; these tables keep what they returned.
-- (A posted invoice is immutable, so the IRN and e-way bill live beside it, not on it.)
CREATE TABLE erp.einvoice_records (
  tenant_id      uuid        NOT NULL REFERENCES erp.tenants (id),
  id             uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  invoice_id     uuid        NOT NULL,
  irn            text        NOT NULL,
  ack_no         text        NOT NULL,
  ack_date       timestamptz NOT NULL,
  signed_qr      text        NOT NULL,
  signed_invoice text,
  status         text        NOT NULL DEFAULT 'active',
  cancelled_at   timestamptz,
  cancel_reason  text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES erp.sales_invoices (tenant_id, id),
  CONSTRAINT einvoice_irn_format CHECK (irn ~ '^[0-9a-f]{64}$'),
  CONSTRAINT einvoice_status_valid CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT einvoice_cancel_facts CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX einvoice_one_active_per_invoice ON erp.einvoice_records (tenant_id, invoice_id) WHERE status = 'active';
CREATE UNIQUE INDEX einvoice_irn_unique ON erp.einvoice_records (tenant_id, irn) WHERE status = 'active';

CREATE TABLE erp.eway_bills (
  tenant_id        uuid        NOT NULL REFERENCES erp.tenants (id),
  id               uuid        NOT NULL,
  company_id       uuid        NOT NULL,
  invoice_id       uuid        NOT NULL,
  bill_no          text        NOT NULL,
  bill_date        timestamptz NOT NULL,
  valid_until      timestamptz,
  transport_mode   text        NOT NULL DEFAULT 'road',
  distance_km      integer,
  vehicle_no       text,
  transporter_id   text,
  transporter_name text,
  trans_doc_no     text,
  status           text        NOT NULL DEFAULT 'active',
  cancelled_at     timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES erp.sales_invoices (tenant_id, id),
  CONSTRAINT eway_bill_no_format CHECK (bill_no ~ '^[0-9]{12}$'),
  CONSTRAINT eway_mode_valid CHECK (transport_mode IN ('road', 'rail', 'air', 'ship')),
  CONSTRAINT eway_status_valid CHECK (status IN ('active', 'cancelled')),
  CONSTRAINT eway_distance_valid CHECK (distance_km IS NULL OR distance_km BETWEEN 1 AND 4000)
);
CREATE UNIQUE INDEX eway_bill_no_unique ON erp.eway_bills (tenant_id, bill_no);

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['einvoice_records', 'eway_bills'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;
GRANT SELECT, INSERT, UPDATE ON erp.einvoice_records, erp.eway_bills TO erp_app;
