-- Bank reconciliation: a company designates which ledger accounts are bank accounts, imports the bank's statements (immutable),
-- and matches each statement line to the ledger lines it corresponds to. A match is never edited, only ended (and a new one made),
-- so the history of who matched what survives. The database re-checks at commit that a matched statement line equals, to the paisa,
-- the ledger lines it is matched to.

CREATE TABLE erp.bank_accounts (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  account_id  uuid        NOT NULL,
  name        text        NOT NULL,
  bank_name   text,
  account_ref text,
  /** Ledger lines on or before this date were reconciled before the books were kept here; they never count as uncleared. */
  cleared_through date,
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT bank_accounts_company_key UNIQUE (tenant_id, company_id, id),
  CONSTRAINT bank_accounts_ledger_unique UNIQUE (tenant_id, account_id),
  CONSTRAINT bank_accounts_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT bank_accounts_status_valid CHECK (status IN ('active', 'inactive'))
);
CREATE FUNCTION erp.guard_bank_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'name' - 'bank_name' - 'account_ref' - 'cleared_through' - 'status' - 'version' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'name' - 'bank_name' - 'account_ref' - 'cleared_through' - 'status' - 'version' - 'updated_at') THEN
    RAISE EXCEPTION 'a bank account only changes its names and status; it is never deleted' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_accounts_guard BEFORE UPDATE OR DELETE ON erp.bank_accounts FOR EACH ROW EXECUTE FUNCTION erp.guard_bank_account();

CREATE TABLE erp.bank_statements (
  tenant_id       uuid          NOT NULL,
  id              uuid          NOT NULL,
  company_id      uuid          NOT NULL,
  bank_account_id uuid          NOT NULL,
  statement_no    text          NOT NULL,
  period_from     date          NOT NULL,
  period_to       date          NOT NULL,
  opening_balance numeric(18,4) NOT NULL,
  closing_balance numeric(18,4) NOT NULL,
  line_count      integer       NOT NULL,
  content_hash    text          NOT NULL,
  status          text          NOT NULL DEFAULT 'active',
  voided_reason   text,
  imported_by     uuid,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, bank_account_id) REFERENCES erp.bank_accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, imported_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT bank_statements_no_unique UNIQUE (tenant_id, statement_no),
  CONSTRAINT bank_statements_hash_unique UNIQUE (tenant_id, bank_account_id, content_hash),
  CONSTRAINT bank_statements_period_valid CHECK (period_to >= period_from),
  CONSTRAINT bank_statements_status_valid CHECK (status IN ('active', 'voided')),
  CONSTRAINT bank_statements_no_overlap EXCLUDE USING gist (tenant_id WITH =, bank_account_id WITH =, daterange(period_from, period_to, '[]') WITH &&) WHERE (status = 'active')
);
CREATE FUNCTION erp.guard_bank_statement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'status' - 'voided_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'voided_reason')
     OR OLD.status = 'voided' OR NEW.status <> 'voided' THEN
    RAISE EXCEPTION 'a bank statement is immutable; it can only be voided, once' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM erp.bank_statement_lines l JOIN erp.bank_matches m ON m.tenant_id = l.tenant_id AND m.statement_line_id = l.id AND m.ended_at IS NULL WHERE l.tenant_id = OLD.tenant_id AND l.statement_id = OLD.id) THEN
    RAISE EXCEPTION 'unmatch the statement lines before voiding the statement' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE erp.bank_statement_lines (
  tenant_id       uuid          NOT NULL,
  id              uuid          NOT NULL,
  statement_id    uuid          NOT NULL,
  company_id      uuid          NOT NULL,
  bank_account_id uuid          NOT NULL,
  line_no         integer       NOT NULL,
  line_date       date          NOT NULL,
  description     text          NOT NULL,
  reference       text,
  amount          numeric(18,4) NOT NULL,
  balance         numeric(18,4),
  status          text          NOT NULL DEFAULT 'unmatched',
  ignore_reason   text,
  updated_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, statement_id) REFERENCES erp.bank_statements (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, bank_account_id) REFERENCES erp.bank_accounts (tenant_id, company_id, id),
  CONSTRAINT bank_statement_lines_no_unique UNIQUE (tenant_id, statement_id, line_no),
  CONSTRAINT bank_statement_lines_amount_nonzero CHECK (amount <> 0),
  CONSTRAINT bank_statement_lines_status_valid CHECK (status IN ('unmatched', 'matched', 'ignored')),
  CONSTRAINT bank_statement_lines_ignore_reason CHECK ((status = 'ignored') = (ignore_reason IS NOT NULL))
);
CREATE INDEX bank_statement_lines_work_idx ON erp.bank_statement_lines (tenant_id, bank_account_id, status, line_date);
CREATE TRIGGER bank_statements_guard BEFORE UPDATE OR DELETE ON erp.bank_statements FOR EACH ROW EXECUTE FUNCTION erp.guard_bank_statement();
CREATE FUNCTION erp.guard_bank_statement_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'status' - 'ignore_reason' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'ignore_reason' - 'updated_at') THEN
    RAISE EXCEPTION 'a bank statement line only changes its matching status; it is never deleted' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_statement_lines_guard BEFORE UPDATE OR DELETE ON erp.bank_statement_lines FOR EACH ROW EXECUTE FUNCTION erp.guard_bank_statement_line();

CREATE TABLE erp.bank_matches (
  tenant_id         uuid          NOT NULL,
  id                uuid          NOT NULL,
  statement_line_id uuid          NOT NULL,
  journal_line_id   uuid          NOT NULL,
  /** The ledger line from the bank account's point of view: debit (money in) positive, credit (money out) negative. */
  amount            numeric(18,4) NOT NULL,
  matched_by        uuid,
  matched_at        timestamptz   NOT NULL DEFAULT now(),
  ended_at          timestamptz,
  ended_by          uuid,
  end_reason        text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, statement_line_id) REFERENCES erp.bank_statement_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_line_id) REFERENCES erp.journal_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, matched_by) REFERENCES erp.users (tenant_id, id),
  FOREIGN KEY (tenant_id, ended_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT bank_matches_ended_together CHECK ((ended_at IS NULL) = (end_reason IS NULL))
);
CREATE UNIQUE INDEX bank_matches_one_active_per_ledger_line ON erp.bank_matches (tenant_id, journal_line_id) WHERE ended_at IS NULL;
CREATE INDEX bank_matches_line_idx ON erp.bank_matches (tenant_id, statement_line_id);

-- A match must be to a ledger line of the statement's own bank account, and may only be ended (once), never edited.
CREATE FUNCTION erp.guard_bank_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_expected uuid;
  v_actual   uuid;
  v_amount   numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'bank matches are never deleted, only ended' USING ERRCODE = '55000';
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
       OR (to_jsonb(NEW) - 'ended_at' - 'ended_by' - 'end_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'ended_at' - 'ended_by' - 'end_reason') THEN
      RAISE EXCEPTION 'a bank match can only be ended, once' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  SELECT b.account_id INTO v_expected FROM erp.bank_statement_lines l JOIN erp.bank_accounts b ON b.tenant_id = l.tenant_id AND b.id = l.bank_account_id WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.statement_line_id;
  SELECT account_id, debit - credit INTO v_actual, v_amount FROM erp.journal_lines WHERE tenant_id = NEW.tenant_id AND id = NEW.journal_line_id;
  IF v_expected IS DISTINCT FROM v_actual THEN
    RAISE EXCEPTION 'the ledger line is not on this bank account' USING ERRCODE = '55000';
  END IF;
  IF NEW.amount <> v_amount THEN
    RAISE EXCEPTION 'the match amount must be the ledger line''s own amount' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_matches_guard BEFORE INSERT OR UPDATE OR DELETE ON erp.bank_matches FOR EACH ROW EXECUTE FUNCTION erp.guard_bank_match();

-- At commit: a statement line is 'matched' exactly when it has active matches, and their total is exactly its amount.
CREATE FUNCTION erp.check_bank_line_matched() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_line_id uuid;
  l         erp.bank_statement_lines;
  v_n       integer;
  v_sum     numeric;
BEGIN
  IF TG_TABLE_NAME = 'bank_matches' THEN
    v_line_id := NEW.statement_line_id;
  ELSE
    v_line_id := NEW.id;
  END IF;
  SELECT * INTO l FROM erp.bank_statement_lines WHERE tenant_id = NEW.tenant_id AND id = v_line_id;
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_n, v_sum FROM erp.bank_matches WHERE tenant_id = NEW.tenant_id AND statement_line_id = v_line_id AND ended_at IS NULL;
  IF (l.status = 'matched') <> (v_n > 0) THEN
    RAISE EXCEPTION 'bank statement line status disagrees with its matches' USING ERRCODE = '23514';
  END IF;
  IF v_n > 0 AND v_sum <> l.amount THEN
    RAISE EXCEPTION 'matched ledger lines (%) do not add up to the statement line (%)', v_sum, l.amount USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER bank_matches_total AFTER INSERT OR UPDATE ON erp.bank_matches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_bank_line_matched();
CREATE CONSTRAINT TRIGGER bank_lines_total AFTER UPDATE OF status ON erp.bank_statement_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp.check_bank_line_matched();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_accounts', 'bank_statements', 'bank_statement_lines', 'bank_matches'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.bank_accounts, erp.bank_statements, erp.bank_statement_lines, erp.bank_matches TO erp_app;
GRANT UPDATE (name, bank_name, account_ref, cleared_through, status, version, updated_at) ON erp.bank_accounts TO erp_app;
GRANT UPDATE (status, voided_reason) ON erp.bank_statements TO erp_app;
GRANT UPDATE (status, ignore_reason, updated_at) ON erp.bank_statement_lines TO erp_app;
GRANT UPDATE (ended_at, ended_by, end_reason) ON erp.bank_matches TO erp_app;
