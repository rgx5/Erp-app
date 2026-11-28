-- Tax collected at source on sales (section 206C): the sections and rates a business may collect under, the amount collected on each invoice, and the deposits made
-- with the government. The invoice total includes the TCS, so what the customer owes, the receivable and the receipt all agree; the TCS itself sits in a liability account
-- until it is deposited.
ALTER TABLE erp.sales_invoices ADD COLUMN tcs_section text, ADD COLUMN tcs_rate numeric(7,4), ADD COLUMN tcs_base numeric(18,4), ADD COLUMN tcs_amount numeric(18,4) NOT NULL DEFAULT 0;
ALTER TABLE erp.sales_invoices ADD CONSTRAINT sales_invoices_tcs_valid CHECK (tcs_amount >= 0 AND (tcs_amount = 0 OR tcs_section IS NOT NULL)) NOT VALID;
-- the grand total now also carries the TCS
ALTER TABLE erp.sales_invoices DROP CONSTRAINT sales_invoices_totals;
ALTER TABLE erp.sales_invoices ADD CONSTRAINT sales_invoices_totals CHECK (grand_total = taxable_total + CASE WHEN reverse_charge THEN 0 ELSE cgst_total + sgst_total + igst_total + cess_total END + round_off + tcs_amount) NOT VALID;

CREATE TABLE erp.tcs_sections (
  tenant_id    uuid          NOT NULL REFERENCES erp.tenants (id),
  id           uuid          NOT NULL,
  code         text          NOT NULL,
  description  text          NOT NULL,
  rate         numeric(7,4)  NOT NULL,
  status       text          NOT NULL DEFAULT 'active',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT tcs_section_rate CHECK (rate >= 0 AND rate <= 100),
  CONSTRAINT tcs_section_status CHECK (status IN ('active', 'inactive'))
);
CREATE UNIQUE INDEX tcs_section_code ON erp.tcs_sections (tenant_id, code);

CREATE TABLE erp.tcs_deposits (
  tenant_id    uuid          NOT NULL REFERENCES erp.tenants (id),
  id           uuid          NOT NULL,
  company_id   uuid          NOT NULL,
  period_from  date          NOT NULL,
  period_to    date          NOT NULL,
  amount       numeric(18,4) NOT NULL,
  deposited_on date          NOT NULL,
  challan_no   text,
  account_id   uuid          NOT NULL,
  entry_id     uuid,
  notes        text,
  created_by   uuid,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES erp.accounts (tenant_id, id),
  CONSTRAINT tcs_deposit_amount CHECK (amount > 0)
);
CREATE INDEX tcs_deposits_company ON erp.tcs_deposits (tenant_id, company_id, deposited_on);

ALTER TABLE erp.tcs_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.tcs_sections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.tcs_sections TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON erp.tcs_sections TO erp_app;
ALTER TABLE erp.tcs_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.tcs_deposits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.tcs_deposits TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT ON erp.tcs_deposits TO erp_app;
