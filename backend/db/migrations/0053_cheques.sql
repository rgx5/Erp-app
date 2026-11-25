-- Cheques in hand and cheques issued, followed from receipt to the bank. Nothing is posted to the books while a cheque is only held or deposited:
-- the receipt (or supplier payment) is made when the cheque clears, so the books show money only once it is really there. A bounced cheque that had
-- already cleared cancels that receipt or payment.
CREATE TABLE erp.cheques (
  tenant_id      uuid          NOT NULL REFERENCES erp.tenants (id),
  id             uuid          NOT NULL,
  company_id     uuid          NOT NULL,
  direction      text          NOT NULL,
  party_id       uuid          NOT NULL,
  cheque_no      text          NOT NULL,
  cheque_date    date          NOT NULL,
  bank_name      text,
  amount         numeric(18,4) NOT NULL,
  status         text          NOT NULL DEFAULT 'pending',
  account_id     uuid,
  allocations    jsonb         NOT NULL DEFAULT '[]',
  notes          text,
  deposited_on   date,
  cleared_on     date,
  bounced_on     date,
  bounce_reason  text,
  receipt_id     uuid,
  payment_id     uuid,
  created_by     uuid,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES erp.accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES erp.customer_receipts (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES erp.supplier_payments (tenant_id, id),
  CONSTRAINT cheques_direction CHECK (direction IN ('received', 'issued')),
  CONSTRAINT cheques_status CHECK (status IN ('pending', 'deposited', 'clearing', 'cleared', 'bounced', 'cancelled')),
  CONSTRAINT cheques_amount CHECK (amount > 0)
);
CREATE UNIQUE INDEX cheques_no ON erp.cheques (tenant_id, company_id, direction, party_id, cheque_no) WHERE status <> 'cancelled';
CREATE INDEX cheques_open ON erp.cheques (tenant_id, company_id, direction, status, cheque_date);
ALTER TABLE erp.cheques ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.cheques FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.cheques TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON erp.cheques TO erp_app;
