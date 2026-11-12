-- Accounting core: chart of accounts, fiscal years and periods (with locking), and the immutable double-entry journal.
-- The database, not the application, guarantees the invariants: a posted entry balances, lands in an OPEN period on a
-- postable account, and can never be changed or deleted afterwards. A mistake is corrected by a reversing entry.

CREATE TABLE erp.accounts (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  type           text        NOT NULL,
  parent_id      uuid,
  is_group       boolean     NOT NULL DEFAULT false,
  -- Control accounts are written only by subledgers (receivables, payables, stock ...), never by manual journals.
  control_kind   text,
  status         text        NOT NULL DEFAULT 'active',
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES erp.accounts (tenant_id, id),
  CONSTRAINT accounts_company_key UNIQUE (tenant_id, company_id, id),
  CONSTRAINT accounts_code_unique UNIQUE (tenant_id, company_id, code),
  CONSTRAINT accounts_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$'),
  CONSTRAINT accounts_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT accounts_type_valid CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  CONSTRAINT accounts_control_kind_valid CHECK (control_kind IS NULL OR control_kind IN ('receivable', 'payable', 'inventory', 'work_in_progress', 'tax')),
  CONSTRAINT accounts_group_not_control CHECK (NOT is_group OR control_kind IS NULL),
  CONSTRAINT accounts_status_valid CHECK (status IN ('active', 'inactive'))
);
CREATE INDEX accounts_parent_idx ON erp.accounts (tenant_id, parent_id);

-- Structure is fixed once created (reports and postings depend on it): type, group-ness, control kind and parent never change,
-- which also makes a cycle in the hierarchy impossible. A parent must be a group of the same company and type.
CREATE FUNCTION erp.guard_account() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  p record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.company_id <> OLD.company_id OR NEW.type <> OLD.type OR NEW.is_group <> OLD.is_group
       OR NEW.control_kind IS DISTINCT FROM OLD.control_kind OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      RAISE EXCEPTION 'an account''s company, type, group-ness, control kind and parent cannot change' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.parent_id IS NOT NULL THEN
    SELECT company_id, type, is_group INTO p FROM erp.accounts WHERE tenant_id = NEW.tenant_id AND id = NEW.parent_id;
    IF NOT FOUND OR p.company_id <> NEW.company_id OR NOT p.is_group OR p.type <> NEW.type THEN
      RAISE EXCEPTION 'the parent must be a group account of the same company and type' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER accounts_guard BEFORE INSERT OR UPDATE ON erp.accounts FOR EACH ROW EXECUTE FUNCTION erp.guard_account();
CREATE TRIGGER accounts_touch BEFORE UPDATE ON erp.accounts FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.fiscal_years (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  label       text        NOT NULL,
  start_date  date        NOT NULL,
  end_date    date        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT fiscal_years_company_key UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fiscal_years_label_unique UNIQUE (tenant_id, company_id, label),
  CONSTRAINT fiscal_years_dates_valid CHECK (end_date > start_date),
  CONSTRAINT fiscal_years_no_overlap EXCLUDE USING gist (tenant_id WITH =, company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE erp.accounting_periods (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL,
  company_id      uuid        NOT NULL,
  fiscal_year_id  uuid        NOT NULL,
  period_no       smallint    NOT NULL,
  name            text        NOT NULL,
  start_date      date        NOT NULL,
  end_date        date        NOT NULL,
  status          text        NOT NULL DEFAULT 'open',
  closed_at       timestamptz,
  locked_at       timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, fiscal_year_id) REFERENCES erp.fiscal_years (tenant_id, company_id, id),
  CONSTRAINT accounting_periods_company_key UNIQUE (tenant_id, company_id, id),
  CONSTRAINT accounting_periods_no_unique UNIQUE (tenant_id, fiscal_year_id, period_no),
  CONSTRAINT accounting_periods_dates_valid CHECK (end_date >= start_date),
  CONSTRAINT accounting_periods_status_valid CHECK (status IN ('open', 'closed', 'locked')),
  CONSTRAINT accounting_periods_no_overlap EXCLUDE USING gist (tenant_id WITH =, company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

-- Period status: open <-> closed (reversible, with permission), closed -> locked (permanent). Nothing else about a period changes.
CREATE FUNCTION erp.guard_period() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'accounting_periods is append-only: DELETE is not allowed' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'closed_at' - 'locked_at' - 'version' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'closed_at' - 'locked_at' - 'version' - 'updated_at')
     OR NOT ((OLD.status = 'open' AND NEW.status = 'closed') OR (OLD.status = 'closed' AND NEW.status IN ('open', 'locked'))) THEN
    RAISE EXCEPTION 'invalid accounting period change (% -> %)', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER accounting_periods_guard BEFORE UPDATE OR DELETE ON erp.accounting_periods FOR EACH ROW EXECUTE FUNCTION erp.guard_period();
CREATE TRIGGER accounting_periods_touch BEFORE UPDATE ON erp.accounting_periods FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

-- ---------------------------------------------------------------------------------------------------------------------
-- The journal. Entries and lines are immutable: no UPDATE, no DELETE, no TRUNCATE, for any role.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.journal_counters (
  tenant_id       uuid        NOT NULL,
  company_id      uuid        NOT NULL,
  fiscal_year_id  uuid        NOT NULL,
  journal_type    text        NOT NULL,
  next_value      bigint      NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, company_id, fiscal_year_id, journal_type),
  FOREIGN KEY (tenant_id, company_id, fiscal_year_id) REFERENCES erp.fiscal_years (tenant_id, company_id, id)
);

CREATE TABLE erp.journal_entries (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  company_id         uuid          NOT NULL,
  fiscal_year_id     uuid          NOT NULL,
  period_id          uuid          NOT NULL,
  entry_no           text          NOT NULL,
  journal_type       text          NOT NULL,
  source_type        text          NOT NULL DEFAULT 'manual',
  source_id          text,
  source_event       text          NOT NULL DEFAULT 'post',
  posting_date       date          NOT NULL,
  description        text          NOT NULL,
  total_debit        numeric(18,4) NOT NULL,
  total_credit       numeric(18,4) NOT NULL,
  line_count         integer       NOT NULL,
  reverses_entry_id  uuid,
  reversal_reason    text,
  posted_by          uuid,
  posted_at          timestamptz   NOT NULL DEFAULT now(),
  tx_id              bigint        NOT NULL DEFAULT txid_current(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, fiscal_year_id) REFERENCES erp.fiscal_years (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, period_id) REFERENCES erp.accounting_periods (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, reverses_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, posted_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT journal_entries_company_key UNIQUE (tenant_id, company_id, id),
  CONSTRAINT journal_entries_no_unique UNIQUE (tenant_id, company_id, entry_no),
  -- An entry can be reversed at most once.
  CONSTRAINT journal_entries_reversed_once UNIQUE (tenant_id, reverses_entry_id),
  CONSTRAINT journal_entries_type_valid CHECK (journal_type IN ('general', 'opening', 'adjustment', 'reversal', 'system')),
  CONSTRAINT journal_entries_source_valid CHECK ((source_type = 'manual') = (source_id IS NULL) OR source_type <> 'manual'),
  CONSTRAINT journal_entries_description_not_blank CHECK (btrim(description) <> ''),
  CONSTRAINT journal_entries_balanced CHECK (total_debit = total_credit AND total_debit > 0),
  CONSTRAINT journal_entries_lines_min CHECK (line_count >= 2),
  CONSTRAINT journal_entries_reversal_shape CHECK ((journal_type = 'reversal') = (reverses_entry_id IS NOT NULL) AND (reverses_entry_id IS NULL) = (reversal_reason IS NULL))
);
-- One entry per (source document, event): a document cannot be posted twice.
CREATE UNIQUE INDEX journal_entries_source_unique ON erp.journal_entries (tenant_id, source_type, source_id, source_event) WHERE source_id IS NOT NULL;
CREATE INDEX journal_entries_date_idx ON erp.journal_entries (tenant_id, company_id, posting_date, id);

CREATE TABLE erp.journal_lines (
  tenant_id            uuid          NOT NULL,
  id                   uuid          NOT NULL,
  entry_id             uuid          NOT NULL,
  company_id           uuid          NOT NULL,
  line_no              integer       NOT NULL,
  account_id           uuid          NOT NULL,
  posting_date         date          NOT NULL,
  debit                numeric(18,4) NOT NULL DEFAULT 0,
  credit               numeric(18,4) NOT NULL DEFAULT 0,
  description          text,
  business_location_id uuid,
  party_id             uuid,
  tx_id                bigint        NOT NULL DEFAULT txid_current(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, entry_id) REFERENCES erp.journal_entries (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, business_location_id) REFERENCES erp.business_locations (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES erp.parties (tenant_id, id),
  CONSTRAINT journal_lines_no_unique UNIQUE (tenant_id, entry_id, line_no),
  CONSTRAINT journal_lines_one_side CHECK (debit >= 0 AND credit >= 0 AND (debit > 0) <> (credit > 0))
);
CREATE INDEX journal_lines_account_idx ON erp.journal_lines (tenant_id, company_id, account_id, posting_date);
CREATE INDEX journal_lines_entry_idx ON erp.journal_lines (tenant_id, entry_id);

CREATE FUNCTION erp.reject_journal_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is immutable: % is not allowed (post a reversing entry instead)', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON erp.journal_entries FOR EACH ROW EXECUTE FUNCTION erp.reject_journal_change();
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON erp.journal_lines FOR EACH ROW EXECUTE FUNCTION erp.reject_journal_change();
CREATE TRIGGER journal_entries_no_truncate BEFORE TRUNCATE ON erp.journal_entries FOR EACH STATEMENT EXECUTE FUNCTION erp.reject_journal_change();
CREATE TRIGGER journal_lines_no_truncate BEFORE TRUNCATE ON erp.journal_lines FOR EACH STATEMENT EXECUTE FUNCTION erp.reject_journal_change();

-- Posting control: the entry must land in an OPEN period that contains its date. FOR SHARE locks the period row, so closing a
-- period (FOR UPDATE) waits for postings in flight and postings wait for a close in progress: no entry slips into a closed period.
CREATE FUNCTION erp.check_posting_period() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  p record;
BEGIN
  SELECT status, start_date, end_date, fiscal_year_id INTO p FROM erp.accounting_periods
   WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND id = NEW.period_id FOR SHARE;
  IF NOT FOUND OR p.status <> 'open' OR NEW.posting_date < p.start_date OR NEW.posting_date > p.end_date OR p.fiscal_year_id <> NEW.fiscal_year_id THEN
    RAISE EXCEPTION 'posting date % is not inside an open accounting period', NEW.posting_date USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER journal_entries_period BEFORE INSERT ON erp.journal_entries FOR EACH ROW EXECUTE FUNCTION erp.check_posting_period();

-- Lines may only be added by the transaction that created their entry, only to postable accounts, and carry the entry's date.
CREATE FUNCTION erp.check_journal_line() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  e record;
  a record;
BEGIN
  SELECT tx_id, posting_date INTO e FROM erp.journal_entries WHERE tenant_id = NEW.tenant_id AND id = NEW.entry_id;
  IF NOT FOUND OR e.tx_id <> txid_current() THEN
    RAISE EXCEPTION 'lines can only be added in the transaction that creates their entry' USING ERRCODE = '55000';
  END IF;
  IF NEW.posting_date <> e.posting_date THEN
    RAISE EXCEPTION 'a line must carry its entry''s posting date' USING ERRCODE = '23514';
  END IF;
  SELECT status, is_group INTO a FROM erp.accounts WHERE tenant_id = NEW.tenant_id AND id = NEW.account_id;
  IF a.is_group OR a.status <> 'active' THEN
    RAISE EXCEPTION 'account is a group or inactive and cannot be posted to' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER journal_lines_check BEFORE INSERT ON erp.journal_lines FOR EACH ROW EXECUTE FUNCTION erp.check_journal_line();

-- At COMMIT: the entry's lines must be exactly what its header says, and debits must equal credits.
CREATE FUNCTION erp.check_entry_complete() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  s record;
BEGIN
  SELECT count(*) AS n, COALESCE(sum(debit), 0) AS d, COALESCE(sum(credit), 0) AS c INTO s
    FROM erp.journal_lines WHERE tenant_id = NEW.tenant_id AND entry_id = NEW.id;
  IF s.n <> NEW.line_count OR s.d <> NEW.total_debit OR s.c <> NEW.total_credit OR s.d <> s.c THEN
    RAISE EXCEPTION 'journal entry % is not balanced or its lines do not match its header', NEW.entry_no USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER journal_entries_complete AFTER INSERT ON erp.journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_entry_complete();

-- ---------------------------------------------------------------------------------------------------------------------
DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts', 'fiscal_years', 'accounting_periods', 'journal_counters', 'journal_entries', 'journal_lines'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.accounts, erp.journal_counters TO erp_app;
GRANT SELECT, INSERT ON erp.fiscal_years, erp.journal_entries, erp.journal_lines TO erp_app;
GRANT SELECT, INSERT ON erp.accounting_periods TO erp_app;
GRANT UPDATE (status, closed_at, locked_at) ON erp.accounting_periods TO erp_app;
