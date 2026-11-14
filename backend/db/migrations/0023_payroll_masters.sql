-- Payroll, part 1: employees and contract workers, salary components and structures, monthly inputs, and the statutory rules
-- (PF, ESI, professional tax, income-tax slabs) as effective-dated, immutable rows: the rule in force on a date is the set with the
-- latest effective_from on or before it, and a change is a new set, never an edit.

CREATE TABLE erp.payroll_settings (
  tenant_id                    uuid        NOT NULL,
  company_id                   uuid        NOT NULL,
  salary_expense_account_id    uuid,
  employer_cost_account_id     uuid,
  salary_payable_account_id    uuid,
  pf_payable_account_id        uuid,
  esi_payable_account_id       uuid,
  pt_payable_account_id        uuid,
  tds_payable_account_id       uuid,
  other_deductions_account_id  uuid,
  version                      integer     NOT NULL DEFAULT 1,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, salary_expense_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, employer_cost_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, salary_payable_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, pf_payable_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, esi_payable_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, pt_payable_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, tds_payable_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, other_deductions_account_id) REFERENCES erp.accounts (tenant_id, company_id, id)
);
CREATE TRIGGER payroll_settings_touch BEFORE UPDATE ON erp.payroll_settings FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

CREATE TABLE erp.employees (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  company_id         uuid          NOT NULL,
  employee_no        text          NOT NULL,
  kind               text          NOT NULL,
  full_name          text          NOT NULL,
  pan                text,
  uan                text,
  esi_no             text,
  state_code         char(2)       NOT NULL,
  date_of_joining    date          NOT NULL,
  date_of_leaving    date,
  pay_basis          text          NOT NULL DEFAULT 'monthly',
  tax_regime         text          NOT NULL DEFAULT 'new',
  tds_rate_percent   numeric(7,4),
  pf_applicable      boolean       NOT NULL DEFAULT false,
  esi_applicable     boolean       NOT NULL DEFAULT false,
  pt_applicable      boolean       NOT NULL DEFAULT false,
  bank_account_ref   text,
  status             text          NOT NULL DEFAULT 'active',
  version            integer       NOT NULL DEFAULT 1,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT employees_no_unique UNIQUE (tenant_id, company_id, employee_no),
  CONSTRAINT employees_kind_valid CHECK (kind IN ('employee', 'contract_worker')),
  CONSTRAINT employees_basis_valid CHECK (pay_basis IN ('monthly', 'daily', 'hourly')),
  CONSTRAINT employees_regime_valid CHECK (tax_regime IN ('new', 'old')),
  CONSTRAINT employees_status_valid CHECK (status IN ('active', 'exited')),
  CONSTRAINT employees_pan_format CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT employees_leaving_valid CHECK (date_of_leaving IS NULL OR date_of_leaving >= date_of_joining),
  CONSTRAINT employees_tds_rate_valid CHECK (tds_rate_percent IS NULL OR (tds_rate_percent >= 0 AND tds_rate_percent <= 100)),
  CONSTRAINT employees_exited_has_date CHECK ((status = 'exited') = (date_of_leaving IS NOT NULL))
);
CREATE UNIQUE INDEX employees_pan_unique ON erp.employees (tenant_id, company_id, pan) WHERE pan IS NOT NULL AND status = 'active';
CREATE TRIGGER employees_touch BEFORE UPDATE ON erp.employees FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

CREATE TABLE erp.salary_components (
  tenant_id     uuid          NOT NULL,
  id            uuid          NOT NULL,
  company_id    uuid          NOT NULL,
  code          text          NOT NULL,
  name          text          NOT NULL,
  kind          text          NOT NULL,
  calculation   text          NOT NULL,
  percent       numeric(7,4),
  is_taxable    boolean       NOT NULL DEFAULT true,
  pf_wage       boolean       NOT NULL DEFAULT false,
  esi_wage      boolean       NOT NULL DEFAULT false,
  status        text          NOT NULL DEFAULT 'active',
  created_at    timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT salary_components_code_unique UNIQUE (tenant_id, company_id, code),
  CONSTRAINT salary_components_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{0,19}$'),
  CONSTRAINT salary_components_kind_valid CHECK (kind IN ('earning', 'deduction')),
  CONSTRAINT salary_components_calc_valid CHECK (calculation IN ('fixed', 'percent_of_basic')),
  CONSTRAINT salary_components_percent_iff CHECK ((calculation = 'percent_of_basic') = (percent IS NOT NULL AND percent > 0 AND percent <= 100)),
  CONSTRAINT salary_components_status_valid CHECK (status IN ('active', 'inactive')),
  CONSTRAINT salary_components_deduction_flags CHECK (kind = 'earning' OR (NOT pf_wage AND NOT esi_wage))
);

CREATE TABLE erp.salary_structures (
  tenant_id       uuid          NOT NULL,
  id              uuid          NOT NULL,
  company_id      uuid          NOT NULL,
  employee_id     uuid          NOT NULL,
  effective_from  date          NOT NULL,
  basic           numeric(18,4) NOT NULL,
  created_by      uuid,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES erp.employees (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT salary_structures_unique UNIQUE (tenant_id, employee_id, effective_from),
  CONSTRAINT salary_structures_basic_positive CHECK (basic > 0)
);
CREATE TABLE erp.salary_structure_lines (
  tenant_id     uuid          NOT NULL,
  id            uuid          NOT NULL,
  structure_id  uuid          NOT NULL,
  component_id  uuid          NOT NULL,
  amount        numeric(18,4),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, structure_id) REFERENCES erp.salary_structures (tenant_id, id),
  FOREIGN KEY (tenant_id, component_id) REFERENCES erp.salary_components (tenant_id, id),
  CONSTRAINT salary_structure_lines_unique UNIQUE (tenant_id, structure_id, component_id),
  CONSTRAINT salary_structure_lines_amount_valid CHECK (amount IS NULL OR amount >= 0)
);

CREATE TABLE erp.payroll_inputs (
  tenant_id        uuid          NOT NULL,
  employee_id      uuid          NOT NULL,
  period           text          NOT NULL,
  lop_days         numeric(6,2)  NOT NULL DEFAULT 0,
  units_worked     numeric(10,2),
  bonus            numeric(18,4) NOT NULL DEFAULT 0,
  other_deduction  numeric(18,4) NOT NULL DEFAULT 0,
  notes            text,
  version          integer       NOT NULL DEFAULT 1,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, employee_id, period),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES erp.employees (tenant_id, id),
  CONSTRAINT payroll_inputs_period_format CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT payroll_inputs_valid CHECK (lop_days >= 0 AND lop_days <= 31 AND (units_worked IS NULL OR units_worked >= 0) AND bonus >= 0 AND other_deduction >= 0)
);
CREATE TRIGGER payroll_inputs_touch BEFORE UPDATE ON erp.payroll_inputs FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

-- Statutory scalar rates: a new row supersedes the previous one from its effective date.
CREATE TABLE erp.payroll_rates (
  tenant_id       uuid          NOT NULL,
  id              uuid          NOT NULL,
  company_id      uuid          NOT NULL,
  code            text          NOT NULL,
  value           numeric(18,6) NOT NULL,
  effective_from  date          NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT payroll_rates_unique UNIQUE (tenant_id, company_id, code, effective_from),
  CONSTRAINT payroll_rates_code_valid CHECK (code IN (
    'pf_employee_percent', 'pf_employer_percent', 'pf_wage_ceiling', 'esi_employee_percent', 'esi_employer_percent', 'esi_wage_ceiling',
    'tds_std_deduction_new', 'tds_std_deduction_old', 'tds_rebate_limit_new', 'tds_rebate_amount_new', 'tds_rebate_limit_old', 'tds_rebate_amount_old', 'tds_cess_percent')),
  CONSTRAINT payroll_rates_value_valid CHECK (value >= 0)
);
-- Slab sets (income-tax slabs per regime, professional-tax slabs per state): all rows of a set share (kind, state, effective_from).
CREATE TABLE erp.payroll_slabs (
  tenant_id       uuid          NOT NULL,
  id              uuid          NOT NULL,
  company_id      uuid          NOT NULL,
  kind            text          NOT NULL,
  state_code      char(2),
  effective_from  date          NOT NULL,
  from_amount     numeric(18,4) NOT NULL,
  to_amount       numeric(18,4),
  rate_percent    numeric(7,4),
  fixed_amount    numeric(18,4),
  created_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT payroll_slabs_kind_valid CHECK (kind IN ('tds_new', 'tds_old', 'pt')),
  CONSTRAINT payroll_slabs_state_iff CHECK ((kind = 'pt') = (state_code IS NOT NULL)),
  CONSTRAINT payroll_slabs_range_valid CHECK (from_amount >= 0 AND (to_amount IS NULL OR to_amount > from_amount)),
  CONSTRAINT payroll_slabs_value_valid CHECK ((kind = 'pt' AND fixed_amount IS NOT NULL AND rate_percent IS NULL) OR (kind <> 'pt' AND rate_percent IS NOT NULL AND fixed_amount IS NULL))
);
CREATE UNIQUE INDEX payroll_slabs_unique ON erp.payroll_slabs (tenant_id, company_id, kind, COALESCE(state_code, '--'), effective_from, from_amount);

CREATE FUNCTION erp.guard_employee() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'date_of_leaving' - 'status' - 'pan' - 'uan' - 'esi_no' - 'state_code' - 'pay_basis' - 'tax_regime' - 'tds_rate_percent' - 'pf_applicable' - 'esi_applicable' - 'pt_applicable' - 'bank_account_ref' - 'full_name' - 'version' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'date_of_leaving' - 'status' - 'pan' - 'uan' - 'esi_no' - 'state_code' - 'pay_basis' - 'tax_regime' - 'tds_rate_percent' - 'pf_applicable' - 'esi_applicable' - 'pt_applicable' - 'bank_account_ref' - 'full_name' - 'version' - 'updated_at') THEN
    RAISE EXCEPTION 'an employee number, kind and joining date are fixed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER employees_guard BEFORE UPDATE OR DELETE ON erp.employees FOR EACH ROW EXECUTE FUNCTION erp.guard_employee();
CREATE FUNCTION erp.guard_salary_component() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'name' - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'name' - 'status') THEN
    RAISE EXCEPTION 'a salary component can only be renamed or deactivated; add a new one to change how it is calculated' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER salary_components_guard BEFORE UPDATE OR DELETE ON erp.salary_components FOR EACH ROW EXECUTE FUNCTION erp.guard_salary_component();
CREATE TRIGGER salary_structures_immutable BEFORE UPDATE OR DELETE ON erp.salary_structures FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER salary_structure_lines_immutable BEFORE UPDATE OR DELETE ON erp.salary_structure_lines FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER payroll_rates_immutable BEFORE UPDATE OR DELETE ON erp.payroll_rates FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER payroll_slabs_immutable BEFORE UPDATE OR DELETE ON erp.payroll_slabs FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_settings', 'employees', 'salary_components', 'salary_structures', 'salary_structure_lines', 'payroll_inputs', 'payroll_rates', 'payroll_slabs'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.payroll_settings, erp.payroll_inputs TO erp_app;
GRANT SELECT, INSERT ON erp.employees, erp.salary_components, erp.salary_structures, erp.salary_structure_lines, erp.payroll_rates, erp.payroll_slabs TO erp_app;
GRANT UPDATE (date_of_leaving, status, pan, uan, esi_no, state_code, pay_basis, tax_regime, tds_rate_percent, pf_applicable, esi_applicable, pt_applicable, bank_account_ref, full_name, version, updated_at) ON erp.employees TO erp_app;
GRANT UPDATE (name, status) ON erp.salary_components TO erp_app;
