-- Tax deducted at source on payments to suppliers: the sections and rates, and each deduction until it is deposited with the government.
CREATE TABLE erp.tds_sections (
  tenant_id     uuid          NOT NULL REFERENCES erp.tenants (id),
  id            uuid          NOT NULL,
  code          text          NOT NULL,
  description   text          NOT NULL,
  rate          numeric(7,4)  NOT NULL,
  single_limit  numeric(18,2) NOT NULL DEFAULT 0,
  annual_limit  numeric(18,2) NOT NULL DEFAULT 0,
  status        text          NOT NULL DEFAULT 'active',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT tds_section_rate CHECK (rate >= 0 AND rate <= 100),
  CONSTRAINT tds_section_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT tds_section_limits CHECK (single_limit >= 0 AND annual_limit >= 0)
);
CREATE UNIQUE INDEX tds_section_code ON erp.tds_sections (tenant_id, code);

CREATE TABLE erp.tds_deductions (
  tenant_id          uuid          NOT NULL REFERENCES erp.tenants (id),
  id                 uuid          NOT NULL,
  company_id         uuid          NOT NULL,
  supplier_id        uuid          NOT NULL,
  payment_id         uuid          NOT NULL,
  section_code       text          NOT NULL,
  rate               numeric(7,4)  NOT NULL,
  base_amount        numeric(18,2) NOT NULL,
  tds_amount         numeric(18,2) NOT NULL,
  pan                text,
  no_pan_rate        boolean       NOT NULL DEFAULT false,
  deducted_on        date          NOT NULL,
  status             text          NOT NULL DEFAULT 'deducted',
  deposit_journal_id uuid,
  challan_no         text,
  challan_date       date,
  bsr_code           text,
  deposited_on       date,
  created_by         uuid,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES erp.supplier_payments (tenant_id, id),
  CONSTRAINT tds_deduction_amount CHECK (tds_amount > 0 AND base_amount > 0 AND tds_amount <= base_amount),
  CONSTRAINT tds_deduction_status CHECK (status IN ('deducted', 'deposited', 'cancelled')),
  CONSTRAINT tds_deduction_deposit CHECK ((status = 'deposited') = (deposited_on IS NOT NULL AND challan_no IS NOT NULL))
);
CREATE UNIQUE INDEX tds_deduction_payment ON erp.tds_deductions (tenant_id, payment_id);
CREATE INDEX tds_deduction_supplier ON erp.tds_deductions (tenant_id, supplier_id, deducted_on);
CREATE INDEX tds_deduction_status ON erp.tds_deductions (tenant_id, status, deducted_on);

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tds_sections', 'tds_deductions'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;
GRANT SELECT, INSERT, UPDATE ON erp.tds_sections, erp.tds_deductions TO erp_app;
