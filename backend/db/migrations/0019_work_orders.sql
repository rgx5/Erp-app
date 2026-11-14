-- Manufacturing, part 2: work orders and work in progress.
-- A work order snapshots its BOM (material requirements, operation hours). Everything that happens to it is an immutable
-- transaction carrying its cost: materials issued to it (stock out, Dr WIP), returned, labour and overhead absorbed at the work
-- centre's rates, finished goods received (stock in at the cost pooled in the order, Cr WIP), and any residual cleared when it is
-- completed. The order's WIP is the sum of its transactions and always equals its share of the WIP control account.

CREATE TABLE erp.manufacturing_settings (
  tenant_id                       uuid        NOT NULL,
  company_id                      uuid        NOT NULL,
  wip_account_id                  uuid,
  labour_absorbed_account_id      uuid,
  overhead_absorbed_account_id    uuid,
  production_variance_account_id  uuid,
  version                         integer     NOT NULL DEFAULT 1,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, wip_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, labour_absorbed_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, overhead_absorbed_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, production_variance_account_id) REFERENCES erp.accounts (tenant_id, company_id, id)
);
CREATE TRIGGER manufacturing_settings_touch BEFORE UPDATE ON erp.manufacturing_settings FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

CREATE TABLE erp.work_orders (
  tenant_id            uuid          NOT NULL,
  id                   uuid          NOT NULL,
  company_id           uuid          NOT NULL,
  wo_no                text          NOT NULL,
  item_id              uuid          NOT NULL,
  bom_id               uuid          NOT NULL,
  planned_quantity     numeric(18,6) NOT NULL,
  produced_quantity    numeric(18,6) NOT NULL DEFAULT 0,
  scrap_quantity       numeric(18,6) NOT NULL DEFAULT 0,
  output_warehouse_id  uuid          NOT NULL,
  materials_warehouse_id uuid        NOT NULL,
  planned_start        date,
  due_date             date,
  notes                text,
  status               text          NOT NULL DEFAULT 'planned',
  released_at          timestamptz,
  completed_at         timestamptz,
  cancelled_at         timestamptz,
  created_by           uuid,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, bom_id) REFERENCES erp.boms (tenant_id, id),
  FOREIGN KEY (tenant_id, output_warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, materials_warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT work_orders_no_unique UNIQUE (tenant_id, company_id, wo_no),
  CONSTRAINT work_orders_quantities CHECK (planned_quantity > 0 AND produced_quantity >= 0 AND scrap_quantity >= 0),
  CONSTRAINT work_orders_status_valid CHECK (status IN ('planned', 'released', 'in_progress', 'completed', 'cancelled')),
  CONSTRAINT work_orders_dates CHECK (due_date IS NULL OR planned_start IS NULL OR due_date >= planned_start)
);

CREATE TABLE erp.work_order_materials (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  work_order_id      uuid          NOT NULL,
  line_no            integer       NOT NULL,
  item_id            uuid          NOT NULL,
  required_quantity  numeric(18,6) NOT NULL,
  issued_quantity    numeric(18,6) NOT NULL DEFAULT 0,
  returned_quantity  numeric(18,6) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES erp.work_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  CONSTRAINT work_order_materials_no_unique UNIQUE (tenant_id, work_order_id, line_no),
  CONSTRAINT work_order_materials_item_unique UNIQUE (tenant_id, work_order_id, item_id),
  CONSTRAINT work_order_materials_valid CHECK (required_quantity > 0 AND issued_quantity >= 0 AND returned_quantity >= 0 AND returned_quantity <= issued_quantity)
);

CREATE TABLE erp.work_order_operations (
  tenant_id       uuid          NOT NULL,
  id              uuid          NOT NULL,
  work_order_id   uuid          NOT NULL,
  op_no           integer       NOT NULL,
  name            text          NOT NULL,
  work_centre_id  uuid          NOT NULL,
  planned_hours   numeric(12,4) NOT NULL,
  actual_hours    numeric(12,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES erp.work_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, work_centre_id) REFERENCES erp.work_centres (tenant_id, id),
  CONSTRAINT work_order_operations_no_unique UNIQUE (tenant_id, work_order_id, op_no),
  CONSTRAINT work_order_operations_valid CHECK (planned_hours >= 0 AND actual_hours >= 0)
);

-- Append-only: what happened to the order and what it cost. `value` is the effect on the order's WIP (issues, labour and overhead
-- add; returns, finished output and the residual clearing take away).
CREATE TABLE erp.work_order_transactions (
  tenant_id         uuid          NOT NULL,
  id                uuid          NOT NULL,
  work_order_id     uuid          NOT NULL,
  company_id        uuid          NOT NULL,
  kind              text          NOT NULL,
  txn_date          date          NOT NULL,
  item_id           uuid,
  operation_id      uuid,
  quantity          numeric(18,6),
  hours             numeric(12,4),
  value             numeric(18,4) NOT NULL,
  stock_movement_id uuid,
  journal_entry_ids uuid[]        NOT NULL DEFAULT '{}',
  note              text,
  created_by        uuid,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES erp.work_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, operation_id) REFERENCES erp.work_order_operations (tenant_id, id),
  FOREIGN KEY (tenant_id, stock_movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT work_order_transactions_kind_valid CHECK (kind IN ('material_issue', 'material_return', 'labour', 'overhead', 'output', 'residual')),
  CONSTRAINT work_order_transactions_sign CHECK (
    (kind IN ('material_issue', 'labour', 'overhead') AND value >= 0) OR (kind IN ('material_return', 'output') AND value <= 0) OR kind = 'residual')
);
CREATE INDEX work_order_transactions_wo_idx ON erp.work_order_transactions (tenant_id, work_order_id, txn_date, id);
CREATE INDEX work_order_transactions_company_idx ON erp.work_order_transactions (tenant_id, company_id, txn_date);

CREATE FUNCTION erp.guard_work_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status IN ('completed', 'cancelled')
     OR (to_jsonb(NEW) - 'status' - 'produced_quantity' - 'scrap_quantity' - 'released_at' - 'completed_at' - 'cancelled_at')
        IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'produced_quantity' - 'scrap_quantity' - 'released_at' - 'completed_at' - 'cancelled_at') THEN
    RAISE EXCEPTION 'a work order can only move through its statuses and totals; it is final once completed or cancelled' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_orders_guard BEFORE UPDATE OR DELETE ON erp.work_orders FOR EACH ROW EXECUTE FUNCTION erp.guard_work_order();

CREATE FUNCTION erp.guard_work_order_material() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'issued_quantity' - 'returned_quantity') IS DISTINCT FROM (to_jsonb(OLD) - 'issued_quantity' - 'returned_quantity') THEN
    RAISE EXCEPTION 'a work order requirement is fixed; only the issued and returned quantities move' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_order_materials_guard BEFORE UPDATE OR DELETE ON erp.work_order_materials FOR EACH ROW EXECUTE FUNCTION erp.guard_work_order_material();
CREATE FUNCTION erp.guard_work_order_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'actual_hours') IS DISTINCT FROM (to_jsonb(OLD) - 'actual_hours') THEN
    RAISE EXCEPTION 'a work order operation is fixed; only the actual hours move' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_order_operations_guard BEFORE UPDATE OR DELETE ON erp.work_order_operations FOR EACH ROW EXECUTE FUNCTION erp.guard_work_order_operation();
CREATE TRIGGER work_order_transactions_immutable BEFORE UPDATE OR DELETE ON erp.work_order_transactions FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['manufacturing_settings', 'work_orders', 'work_order_materials', 'work_order_operations', 'work_order_transactions'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.manufacturing_settings TO erp_app;
GRANT SELECT, INSERT ON erp.work_orders, erp.work_order_materials, erp.work_order_operations, erp.work_order_transactions TO erp_app;
GRANT UPDATE (status, produced_quantity, scrap_quantity, released_at, completed_at, cancelled_at) ON erp.work_orders TO erp_app;
GRANT UPDATE (issued_quantity, returned_quantity) ON erp.work_order_materials TO erp_app;
GRANT UPDATE (actual_hours) ON erp.work_order_operations TO erp_app;
