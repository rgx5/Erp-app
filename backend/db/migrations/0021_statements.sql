-- Financial statements and year-end close: accounting settings (retained earnings), the mapping of chart accounts to Schedule III
-- statement lines, and the record of each fiscal year's closing entry.

CREATE TABLE erp.accounting_settings (
  tenant_id                    uuid        NOT NULL,
  company_id                   uuid        NOT NULL,
  retained_earnings_account_id uuid,
  version                      integer     NOT NULL DEFAULT 1,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, retained_earnings_account_id) REFERENCES erp.accounts (tenant_id, company_id, id)
);
CREATE TRIGGER accounting_settings_touch BEFORE UPDATE ON erp.accounting_settings FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

CREATE TABLE erp.statement_mappings (
  tenant_id   uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  account_id  uuid        NOT NULL,
  line_code   text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id, account_id),
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  CONSTRAINT statement_mappings_line_format CHECK (line_code ~ '^(BS|PL)\.[A-Z_]+$')
);

CREATE TABLE erp.fiscal_year_closings (
  tenant_id         uuid          NOT NULL,
  id                uuid          NOT NULL,
  company_id        uuid          NOT NULL,
  fiscal_year_id    uuid          NOT NULL,
  closing_entry_id  uuid,
  net_profit        numeric(18,4) NOT NULL,
  status            text          NOT NULL DEFAULT 'closed',
  closed_by         uuid,
  closed_at         timestamptz   NOT NULL DEFAULT now(),
  reopened_by       uuid,
  reopened_at       timestamptz,
  reopen_reason     text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES erp.fiscal_years (tenant_id, id),
  FOREIGN KEY (tenant_id, closing_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, closed_by) REFERENCES erp.users (tenant_id, id),
  FOREIGN KEY (tenant_id, reopened_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT fiscal_year_closings_status_valid CHECK (status IN ('closed', 'reopened')),
  CONSTRAINT fiscal_year_closings_reopen_consistent CHECK ((status = 'reopened') = (reopened_at IS NOT NULL AND reopen_reason IS NOT NULL))
);
-- At most one live closing per fiscal year.
CREATE UNIQUE INDEX fiscal_year_closings_live ON erp.fiscal_year_closings (tenant_id, fiscal_year_id) WHERE status = 'closed';

CREATE FUNCTION erp.guard_fiscal_year_closing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'closed' OR NEW.status <> 'reopened'
     OR (to_jsonb(NEW) - 'status' - 'reopened_by' - 'reopened_at' - 'reopen_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'reopened_by' - 'reopened_at' - 'reopen_reason') THEN
    RAISE EXCEPTION 'a year-end closing can only be reopened, once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_year_closings_guard BEFORE UPDATE OR DELETE ON erp.fiscal_year_closings FOR EACH ROW EXECUTE FUNCTION erp.guard_fiscal_year_closing();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounting_settings', 'statement_mappings', 'fiscal_year_closings'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.accounting_settings, erp.statement_mappings TO erp_app;
GRANT SELECT, INSERT ON erp.fiscal_year_closings TO erp_app;
GRANT UPDATE (status, reopened_by, reopened_at, reopen_reason) ON erp.fiscal_year_closings TO erp_app;
