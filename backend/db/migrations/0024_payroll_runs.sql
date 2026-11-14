-- Payroll, part 2: monthly runs and payslips, payment of net salary, and remittance of statutory deductions.
-- A posted run is immutable (it snapshots every figure and the rules it used) and can only be cancelled while unpaid.

CREATE TABLE erp.payroll_runs (
  tenant_id            uuid          NOT NULL,
  id                   uuid          NOT NULL,
  company_id           uuid          NOT NULL,
  run_no               text          NOT NULL,
  period               text          NOT NULL,
  pay_date             date          NOT NULL,
  gross_total          numeric(18,4) NOT NULL,
  employee_deductions  numeric(18,4) NOT NULL,
  net_total            numeric(18,4) NOT NULL,
  employer_cost_total  numeric(18,4) NOT NULL,
  pf_total             numeric(18,4) NOT NULL DEFAULT 0,
  esi_total            numeric(18,4) NOT NULL DEFAULT 0,
  pt_total             numeric(18,4) NOT NULL DEFAULT 0,
  tds_total            numeric(18,4) NOT NULL DEFAULT 0,
  journal_entry_id     uuid,
  status               text          NOT NULL DEFAULT 'posted',
  paid_on              date,
  payment_journal_id   uuid,
  cancelled_at         timestamptz,
  cancel_reason        text,
  cancel_journal_id    uuid,
  created_by           uuid,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, payment_journal_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, cancel_journal_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT payroll_runs_no_unique UNIQUE (tenant_id, company_id, run_no),
  CONSTRAINT payroll_runs_period_format CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT payroll_runs_status_valid CHECK (status IN ('posted', 'paid', 'cancelled')),
  CONSTRAINT payroll_runs_paid_consistent CHECK ((status = 'paid') = (paid_on IS NOT NULL AND payment_journal_id IS NOT NULL)),
  CONSTRAINT payroll_runs_cancel_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
-- One live run per company and month.
CREATE UNIQUE INDEX payroll_runs_live_period ON erp.payroll_runs (tenant_id, company_id, period) WHERE status <> 'cancelled';

CREATE TABLE erp.payslips (
  tenant_id           uuid          NOT NULL,
  id                  uuid          NOT NULL,
  run_id              uuid          NOT NULL,
  employee_id         uuid          NOT NULL,
  employee_no         text          NOT NULL,
  employee_name       text          NOT NULL,
  kind                text          NOT NULL,
  period              text          NOT NULL,
  gross               numeric(18,4) NOT NULL,
  pf_employee         numeric(18,4) NOT NULL DEFAULT 0,
  pf_employer         numeric(18,4) NOT NULL DEFAULT 0,
  esi_employee        numeric(18,4) NOT NULL DEFAULT 0,
  esi_employer        numeric(18,4) NOT NULL DEFAULT 0,
  professional_tax    numeric(18,4) NOT NULL DEFAULT 0,
  tds                 numeric(18,4) NOT NULL DEFAULT 0,
  other_deductions    numeric(18,4) NOT NULL DEFAULT 0,
  net                 numeric(18,4) NOT NULL,
  detail              jsonb         NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES erp.payroll_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES erp.employees (tenant_id, id),
  CONSTRAINT payslips_one_per_run UNIQUE (tenant_id, run_id, employee_id),
  CONSTRAINT payslips_net_consistent CHECK (net = gross - pf_employee - esi_employee - professional_tax - tds - other_deductions)
);
CREATE INDEX payslips_employee_idx ON erp.payslips (tenant_id, employee_id, period);

CREATE TABLE erp.statutory_remittances (
  tenant_id         uuid          NOT NULL,
  id                uuid          NOT NULL,
  company_id        uuid          NOT NULL,
  remittance_no     text          NOT NULL,
  kind              text          NOT NULL,
  period            text          NOT NULL,
  remitted_on       date          NOT NULL,
  amount            numeric(18,4) NOT NULL,
  reference         text,
  journal_entry_id  uuid          NOT NULL,
  created_by        uuid,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT statutory_remittances_no_unique UNIQUE (tenant_id, company_id, remittance_no),
  CONSTRAINT statutory_remittances_kind_valid CHECK (kind IN ('pf', 'esi', 'pt', 'tds')),
  CONSTRAINT statutory_remittances_period_format CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT statutory_remittances_amount_positive CHECK (amount > 0)
);

CREATE FUNCTION erp.guard_payroll_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'cancelled'
     OR (to_jsonb(NEW) - 'status' - 'paid_on' - 'payment_journal_id' - 'cancelled_at' - 'cancel_reason' - 'cancel_journal_id') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'paid_on' - 'payment_journal_id' - 'cancelled_at' - 'cancel_reason' - 'cancel_journal_id')
     OR (OLD.status = 'paid' AND NEW.status <> 'paid') OR (OLD.status = 'posted' AND NEW.status = 'posted') THEN
    RAISE EXCEPTION 'a payroll run is immutable; it can be paid or cancelled (unpaid) once' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payroll_runs_guard BEFORE UPDATE OR DELETE ON erp.payroll_runs FOR EACH ROW EXECUTE FUNCTION erp.guard_payroll_run();
CREATE TRIGGER payslips_immutable BEFORE UPDATE OR DELETE ON erp.payslips FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER statutory_remittances_immutable BEFORE UPDATE OR DELETE ON erp.statutory_remittances FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_runs', 'payslips', 'statutory_remittances'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.payroll_runs, erp.payslips, erp.statutory_remittances TO erp_app;
GRANT UPDATE (status, paid_on, payment_journal_id, cancelled_at, cancel_reason, cancel_journal_id) ON erp.payroll_runs TO erp_app;
