-- Gift cards: prepaid value a customer buys at the counter and spends later. What is sold is a liability, not income: it becomes
-- sales when the card is used. The balance can never go below zero (the database refuses it), and every movement is recorded.
CREATE TABLE erp.gift_cards (
  tenant_id      uuid          NOT NULL REFERENCES erp.tenants (id),
  id             uuid          NOT NULL,
  company_id     uuid          NOT NULL,
  code           text          NOT NULL,
  initial_amount numeric(18,4) NOT NULL,
  balance        numeric(18,4) NOT NULL,
  holder_name    text,
  expires_on     date,
  status         text          NOT NULL DEFAULT 'active',
  version        integer       NOT NULL DEFAULT 1,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT gift_cards_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{5,29}$'),
  CONSTRAINT gift_cards_amount_valid CHECK (initial_amount > 0),
  CONSTRAINT gift_cards_balance_valid CHECK (balance >= 0 AND balance <= initial_amount),
  CONSTRAINT gift_cards_status_valid CHECK (status IN ('active', 'cancelled'))
);
CREATE UNIQUE INDEX gift_cards_code_unique ON erp.gift_cards (tenant_id, code);

CREATE TABLE erp.gift_card_entries (
  tenant_id        uuid          NOT NULL REFERENCES erp.tenants (id),
  id               uuid          NOT NULL,
  card_id          uuid          NOT NULL,
  kind             text          NOT NULL,
  amount           numeric(18,4) NOT NULL,
  method           text,
  pos_sale_id      uuid,
  shift_id         uuid,
  journal_entry_id uuid,
  created_by       uuid,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, card_id) REFERENCES erp.gift_cards (tenant_id, id),
  CONSTRAINT gift_card_entries_kind_valid CHECK (kind IN ('issue', 'redeem')),
  CONSTRAINT gift_card_entries_amount_valid CHECK (amount > 0)
);
CREATE TRIGGER gift_card_entries_immutable BEFORE UPDATE OR DELETE ON erp.gift_card_entries FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gift_cards', 'gift_card_entries'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;
GRANT SELECT, INSERT, UPDATE ON erp.gift_cards TO erp_app;
GRANT SELECT, INSERT ON erp.gift_card_entries TO erp_app;

-- A gift card is a way to pay at the counter: its own payment method, mapped to the gift card liability account.
ALTER TABLE erp.customer_receipts DROP CONSTRAINT customer_receipts_method_valid;
ALTER TABLE erp.customer_receipts ADD CONSTRAINT customer_receipts_method_valid CHECK (method IN ('cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other', 'gift_card'));
ALTER TABLE erp.pos_payment_accounts DROP CONSTRAINT pos_payment_accounts_method_valid;
ALTER TABLE erp.pos_payment_accounts ADD CONSTRAINT pos_payment_accounts_method_valid CHECK (method IN ('cash', 'bank_transfer', 'upi', 'card', 'cheque', 'other', 'gift_card'));
