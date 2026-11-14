-- Manufacturing, part 1: work centres, bills of materials (versioned, effective-dated) and routing operations.
-- A BOM never changes once created (a change is a new version); it can only be made obsolete. For one item, active BOMs can
-- never overlap in time, whatever the application does.

CREATE TABLE erp.work_centres (
  tenant_id               uuid          NOT NULL,
  id                      uuid          NOT NULL,
  company_id              uuid          NOT NULL,
  code                    text          NOT NULL,
  name                    text          NOT NULL,
  labour_rate_per_hour    numeric(18,4) NOT NULL DEFAULT 0,
  machine_rate_per_hour   numeric(18,4) NOT NULL DEFAULT 0,
  overhead_rate_per_hour  numeric(18,4) NOT NULL DEFAULT 0,
  status                  text          NOT NULL DEFAULT 'active',
  version                 integer       NOT NULL DEFAULT 1,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT work_centres_code_unique UNIQUE (tenant_id, company_id, code),
  CONSTRAINT work_centres_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9._-]{0,29}$'),
  CONSTRAINT work_centres_rates CHECK (labour_rate_per_hour >= 0 AND machine_rate_per_hour >= 0 AND overhead_rate_per_hour >= 0),
  CONSTRAINT work_centres_status_valid CHECK (status IN ('active', 'inactive'))
);
CREATE TRIGGER work_centres_touch BEFORE UPDATE ON erp.work_centres FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

CREATE TABLE erp.boms (
  tenant_id        uuid          NOT NULL,
  id               uuid          NOT NULL,
  company_id       uuid          NOT NULL,
  item_id          uuid          NOT NULL,
  bom_no           text          NOT NULL,
  version          integer       NOT NULL,
  description      text,
  base_quantity    numeric(18,6) NOT NULL DEFAULT 1,
  effective_from   date          NOT NULL,
  effective_to     date,
  status           text          NOT NULL DEFAULT 'active',
  created_by       uuid,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT boms_no_unique UNIQUE (tenant_id, company_id, bom_no),
  CONSTRAINT boms_version_unique UNIQUE (tenant_id, company_id, item_id, version),
  CONSTRAINT boms_base_positive CHECK (base_quantity > 0),
  CONSTRAINT boms_period_valid CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT boms_status_valid CHECK (status IN ('active', 'obsolete')),
  CONSTRAINT boms_no_overlap EXCLUDE USING gist (tenant_id WITH =, company_id WITH =, item_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&) WHERE (status = 'active')
);

CREATE TABLE erp.bom_lines (
  tenant_id        uuid          NOT NULL,
  id               uuid          NOT NULL,
  bom_id           uuid          NOT NULL,
  line_no          integer       NOT NULL,
  item_id          uuid          NOT NULL,
  quantity         numeric(18,6) NOT NULL,
  scrap_percent    numeric(7,4)  NOT NULL DEFAULT 0,
  notes            text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, bom_id) REFERENCES erp.boms (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  CONSTRAINT bom_lines_no_unique UNIQUE (tenant_id, bom_id, line_no),
  CONSTRAINT bom_lines_item_unique UNIQUE (tenant_id, bom_id, item_id),
  CONSTRAINT bom_lines_valid CHECK (quantity > 0 AND scrap_percent >= 0 AND scrap_percent < 100)
);

CREATE TABLE erp.bom_operations (
  tenant_id            uuid          NOT NULL,
  id                   uuid          NOT NULL,
  bom_id               uuid          NOT NULL,
  op_no                integer       NOT NULL,
  name                 text          NOT NULL,
  work_centre_id       uuid          NOT NULL,
  setup_hours          numeric(12,4) NOT NULL DEFAULT 0,
  run_hours            numeric(12,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, bom_id) REFERENCES erp.boms (tenant_id, id),
  FOREIGN KEY (tenant_id, work_centre_id) REFERENCES erp.work_centres (tenant_id, id),
  CONSTRAINT bom_operations_no_unique UNIQUE (tenant_id, bom_id, op_no),
  CONSTRAINT bom_operations_valid CHECK (op_no > 0 AND setup_hours >= 0 AND run_hours >= 0)
);

CREATE FUNCTION erp.guard_bom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'obsolete' OR NEW.status <> 'obsolete'
     OR (to_jsonb(NEW) - 'status' - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'effective_to') THEN
    RAISE EXCEPTION 'a bill of materials is immutable; it can only be made obsolete (once)' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER boms_guard BEFORE UPDATE OR DELETE ON erp.boms FOR EACH ROW EXECUTE FUNCTION erp.guard_bom();
CREATE TRIGGER bom_lines_immutable BEFORE UPDATE OR DELETE ON erp.bom_lines FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER bom_operations_immutable BEFORE UPDATE OR DELETE ON erp.bom_operations FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_centres', 'boms', 'bom_lines', 'bom_operations'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.work_centres, erp.boms, erp.bom_lines, erp.bom_operations TO erp_app;
GRANT UPDATE (name, labour_rate_per_hour, machine_rate_per_hour, overhead_rate_per_hour, status, version, updated_at) ON erp.work_centres TO erp_app;
GRANT UPDATE (status, effective_to) ON erp.boms TO erp_app;
