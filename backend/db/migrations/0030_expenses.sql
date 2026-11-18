-- Expense vouchers: small day-to-day spending paid from cash or bank (tea, courier, repairs), booked straight to an expense account.
-- A category fixes the expense account, so the person recording a voucher only picks "what for", not an account.
-- A voucher posts one journal (Dr expense, Cr cash or bank) and is never edited; a mistake is cancelled, which reverses the journal.

CREATE TABLE erp.expense_categories (
  tenant_id          uuid        NOT NULL REFERENCES erp.tenants (id),
  id                 uuid        NOT NULL,
  company_id         uuid        NOT NULL,
  code               text        NOT NULL,
  name               text        NOT NULL,
  expense_account_id uuid        NOT NULL,
  status             text        NOT NULL DEFAULT 'active',
  version            integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, expense_account_id) REFERENCES erp.accounts (tenant_id, id),
  CONSTRAINT expense_categories_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,29}$'),
  CONSTRAINT expense_categories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT expense_categories_status_valid CHECK (status IN ('active', 'inactive'))
);
CREATE UNIQUE INDEX expense_categories_code_unique ON erp.expense_categories (tenant_id, company_id, lower(code));

CREATE TABLE erp.expense_vouchers (
  tenant_id             uuid          NOT NULL REFERENCES erp.tenants (id),
  id                    uuid          NOT NULL,
  company_id            uuid          NOT NULL,
  voucher_no            text          NOT NULL,
  voucher_date          date          NOT NULL,
  category_id           uuid          NOT NULL,
  amount                numeric(18,4) NOT NULL,
  paid_from_account_id  uuid          NOT NULL,
  payee                 text,
  note                  text,
  journal_entry_id      uuid          NOT NULL,
  status                text          NOT NULL DEFAULT 'posted',
  cancelled_at          timestamptz,
  cancel_reason         text,
  cancel_journal_id     uuid,
  created_by            uuid,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES erp.expense_categories (tenant_id, id),
  FOREIGN KEY (tenant_id, paid_from_account_id) REFERENCES erp.accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  CONSTRAINT expense_vouchers_amount_positive CHECK (amount > 0),
  CONSTRAINT expense_vouchers_status_valid CHECK (status IN ('posted', 'cancelled'))
);
CREATE UNIQUE INDEX expense_vouchers_no_unique ON erp.expense_vouchers (tenant_id, company_id, voucher_no);
CREATE INDEX expense_vouchers_by_date ON erp.expense_vouchers (tenant_id, company_id, voucher_date DESC, id DESC);

CREATE FUNCTION erp.guard_expense_voucher() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'status' - 'cancelled_at' - 'cancel_reason' - 'cancel_journal_id')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'cancelled_at' - 'cancel_reason' - 'cancel_journal_id') THEN
    RAISE EXCEPTION 'an expense voucher is never edited or deleted; cancel it' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'cancelled' THEN RAISE EXCEPTION 'a cancelled voucher stays cancelled' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expense_vouchers_guard BEFORE UPDATE OR DELETE ON erp.expense_vouchers FOR EACH ROW EXECUTE FUNCTION erp.guard_expense_voucher();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_categories', 'expense_vouchers'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.expense_categories TO erp_app;
GRANT SELECT, INSERT ON erp.expense_vouchers TO erp_app;
GRANT UPDATE (status, cancelled_at, cancel_reason, cancel_journal_id) ON erp.expense_vouchers TO erp_app;
