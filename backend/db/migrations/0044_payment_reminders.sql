-- A record of who was reminded about what they owe, how, and when, so two people do not chase the same customer on the same day.
CREATE TABLE erp.payment_reminders (
  tenant_id   uuid          NOT NULL REFERENCES erp.tenants (id),
  id          uuid          NOT NULL,
  company_id  uuid          NOT NULL,
  customer_id uuid          NOT NULL,
  channel     text          NOT NULL,
  amount_due  numeric(18,4) NOT NULL,
  message     text          NOT NULL,
  created_by  uuid,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT payment_reminders_channel_valid CHECK (channel IN ('whatsapp', 'sms', 'email', 'call', 'copied')),
  CONSTRAINT payment_reminders_amount_valid CHECK (amount_due > 0),
  CONSTRAINT payment_reminders_message_valid CHECK (length(message) BETWEEN 1 AND 2000)
);
CREATE INDEX payment_reminders_customer_idx ON erp.payment_reminders (tenant_id, company_id, customer_id, created_at DESC);
CREATE TRIGGER payment_reminders_immutable BEFORE UPDATE OR DELETE ON erp.payment_reminders FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
ALTER TABLE erp.payment_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.payment_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.payment_reminders TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT ON erp.payment_reminders TO erp_app;
