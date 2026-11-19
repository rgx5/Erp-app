-- Site identity (deployment sprint 2). A "site" is one place a client's server runs: a head office, a branch, a factory. Today every client has
-- one; later several. Documents and events record the site they were created at, so multi-site can be added without rewriting history.
--
-- Convention: a NULL site_id means the tenant's primary site. Existing rows keep NULL (nothing is rewritten), and new rows take the site this
-- server is configured with (SITE_ID, set on the database connection as app.site_id), or NULL when the server has none (single-site and
-- shared-cloud deployments). A site's series_code is added to the prefix of document numbers issued there so two sites never issue the same number.
CREATE TABLE erp.sites (
  tenant_id   uuid        NOT NULL REFERENCES erp.tenants (id),
  id          uuid        NOT NULL,
  code        text        NOT NULL,
  name        text        NOT NULL,
  series_code text        NOT NULL DEFAULT '',
  is_primary  boolean     NOT NULL DEFAULT false,
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT sites_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$'),
  CONSTRAINT sites_series_code_format CHECK (series_code ~ '^[A-Z0-9]{0,2}$'),
  CONSTRAINT sites_primary_series CHECK ((is_primary AND series_code = '') OR (NOT is_primary AND series_code <> '')),
  CONSTRAINT sites_status_valid CHECK (status IN ('active', 'closed'))
);
CREATE UNIQUE INDEX sites_code_unique ON erp.sites (tenant_id, lower(code));
CREATE UNIQUE INDEX sites_series_code_unique ON erp.sites (tenant_id, series_code) WHERE series_code <> '';
CREATE UNIQUE INDEX sites_one_primary ON erp.sites (tenant_id) WHERE is_primary;
CREATE TRIGGER sites_touch BEFORE UPDATE ON erp.sites FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

ALTER TABLE erp.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.sites FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.sites TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON erp.sites TO erp_app;

-- The site this server runs at: the connection setting app.site_id, or NULL.
CREATE FUNCTION erp.current_site_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.site_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION erp.current_site_id() TO erp_app;

DO $sites$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_quotes', 'sales_orders', 'sales_invoices', 'customer_receipts', 'purchase_orders', 'goods_receipts', 'supplier_bills', 'supplier_payments',
                           'journal_entries', 'stock_movements', 'pos_shifts', 'pos_sales', 'expense_vouchers', 'work_orders', 'payroll_runs', 'outbox_events', 'audit_log', 'number_series'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ADD COLUMN site_id uuid DEFAULT erp.current_site_id()', t);
    EXECUTE format('ALTER TABLE erp.%I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, site_id) REFERENCES erp.sites (tenant_id, id)', t, t || '_site_fk');
  END LOOP;
END
$sites$;

-- A series belongs to a site as well as a registration, year and document type.
ALTER TABLE erp.number_series DROP CONSTRAINT number_series_scope_unique;
CREATE UNIQUE INDEX number_series_scope_unique ON erp.number_series (tenant_id, gst_registration_id, document_type, financial_year, COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid));
