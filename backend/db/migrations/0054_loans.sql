-- Loan accounts: money borrowed (taken) and money lent (given). A loan has a repayment schedule (instalments of principal and interest); paying an
-- instalment posts the principal against the loan account and the interest to the expense or income account, in one entry with the bank movement.
CREATE TABLE erp.loans (
  tenant_id          uuid          NOT NULL REFERENCES erp.tenants (id),
  id                 uuid          NOT NULL,
  company_id         uuid          NOT NULL,
  direction          text          NOT NULL,
  loan_no            text          NOT NULL,
  name               text          NOT NULL,
  party_id           uuid,
  principal          numeric(18,4) NOT NULL,
  annual_rate        numeric(8,4)  NOT NULL DEFAULT 0,
  method             text          NOT NULL DEFAULT 'reducing',
  tenure_months      integer       NOT NULL,
  disbursed_on       date          NOT NULL,
  first_due_on       date          NOT NULL,
  emi                numeric(18,4) NOT NULL,
  loan_account_id    uuid          NOT NULL,
  interest_account_id uuid         NOT NULL,
  bank_account_id    uuid          NOT NULL,
  disbursal_entry_id uuid,
  status             text          NOT NULL DEFAULT 'active',
  closed_on          date,
  notes              text,
  created_by         uuid,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, loan_account_id) REFERENCES erp.accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, interest_account_id) REFERENCES erp.accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, bank_account_id) REFERENCES erp.accounts (tenant_id, id),
  CONSTRAINT loans_direction CHECK (direction IN ('taken', 'given')),
  CONSTRAINT loans_method CHECK (method IN ('reducing', 'flat')),
  CONSTRAINT loans_status CHECK (status IN ('active', 'closed', 'cancelled')),
  CONSTRAINT loans_amounts CHECK (principal > 0 AND annual_rate >= 0 AND tenure_months > 0 AND emi > 0)
);
CREATE UNIQUE INDEX loans_no ON erp.loans (tenant_id, company_id, loan_no);
CREATE INDEX loans_company ON erp.loans (tenant_id, company_id, direction, status);

CREATE TABLE erp.loan_installments (
  tenant_id   uuid          NOT NULL REFERENCES erp.tenants (id),
  id          uuid          NOT NULL,
  loan_id     uuid          NOT NULL,
  no          integer       NOT NULL,
  due_date    date          NOT NULL,
  principal   numeric(18,4) NOT NULL,
  interest    numeric(18,4) NOT NULL,
  emi         numeric(18,4) NOT NULL,
  status      text          NOT NULL DEFAULT 'due',
  paid_on     date,
  paid_account_id uuid,
  entry_id    uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, loan_id) REFERENCES erp.loans (tenant_id, id),
  CONSTRAINT loan_installments_status CHECK (status IN ('due', 'paid', 'waived'))
);
CREATE UNIQUE INDEX loan_installments_no ON erp.loan_installments (tenant_id, loan_id, no);
CREATE INDEX loan_installments_due ON erp.loan_installments (tenant_id, status, due_date);

ALTER TABLE erp.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.loans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.loans TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON erp.loans TO erp_app;
ALTER TABLE erp.loan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.loan_installments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.loan_installments TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON erp.loan_installments TO erp_app;
