-- Recurring invoices: a template that raises the same invoice every week, month, quarter, half year or year.
-- Each occurrence is an ordinary posted invoice (stock, tax and ledger as always); the template only remembers when the next one is due.
CREATE TABLE erp.recurring_invoices (
  tenant_id           uuid          NOT NULL REFERENCES erp.tenants (id),
  id                  uuid          NOT NULL,
  company_id          uuid          NOT NULL,
  name                text          NOT NULL,
  gst_registration_id uuid          NOT NULL,
  business_location_id uuid,
  customer_id         uuid          NOT NULL,
  document_type       text          NOT NULL DEFAULT 'tax_invoice',
  frequency           text          NOT NULL,
  anchor_day          smallint      NOT NULL,
  start_date          date          NOT NULL,
  end_date            date,
  next_run_date       date          NOT NULL,
  last_run_date       date,
  run_count           integer       NOT NULL DEFAULT 0,
  status              text          NOT NULL DEFAULT 'active',
  last_error          text,
  notes               text,
  lines               jsonb         NOT NULL,
  version             integer       NOT NULL DEFAULT 1,
  created_by          uuid,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT recurring_invoices_frequency_valid CHECK (frequency IN ('weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly')),
  CONSTRAINT recurring_invoices_status_valid CHECK (status IN ('active', 'paused', 'ended')),
  CONSTRAINT recurring_invoices_doc_valid CHECK (document_type IN ('tax_invoice', 'bill_of_supply')),
  CONSTRAINT recurring_invoices_dates_valid CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT recurring_invoices_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT recurring_invoices_lines_array CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) > 0)
);
CREATE INDEX recurring_invoices_due_idx ON erp.recurring_invoices (tenant_id, company_id, next_run_date) WHERE status = 'active';

CREATE TABLE erp.recurring_invoice_runs (
  tenant_id      uuid        NOT NULL REFERENCES erp.tenants (id),
  id             uuid        NOT NULL,
  recurring_id   uuid        NOT NULL,
  scheduled_date date        NOT NULL,
  status         text        NOT NULL,
  invoice_id     uuid,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, recurring_id) REFERENCES erp.recurring_invoices (tenant_id, id),
  CONSTRAINT recurring_invoice_runs_status_valid CHECK (status IN ('posted', 'failed')),
  CONSTRAINT recurring_invoice_runs_invoice_iff_posted CHECK ((status = 'posted') = (invoice_id IS NOT NULL))
);
CREATE UNIQUE INDEX recurring_invoice_runs_once ON erp.recurring_invoice_runs (tenant_id, recurring_id, scheduled_date) WHERE status = 'posted';
CREATE TRIGGER recurring_invoice_runs_immutable BEFORE UPDATE OR DELETE ON erp.recurring_invoice_runs FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recurring_invoices', 'recurring_invoice_runs'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;
GRANT SELECT, INSERT, UPDATE ON erp.recurring_invoices TO erp_app;
GRANT SELECT, INSERT ON erp.recurring_invoice_runs TO erp_app;
