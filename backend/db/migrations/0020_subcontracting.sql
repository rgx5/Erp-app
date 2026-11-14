-- Manufacturing, part 3: subcontracting (job work). A subcontract order is a work order whose materials are held at the job
-- worker's warehouse. Materials travel on delivery challans (stock transfers, no ledger entry: the goods stay ours); at receipt the
-- materials actually used are consumed into WIP, the job-work charge is capitalised from a clearing account (the job worker's invoice
-- is booked as an ordinary supplier bill to that account) and the finished goods come into stock at the pooled cost.

ALTER TABLE erp.manufacturing_settings ADD COLUMN subcontract_clearing_account_id uuid;
ALTER TABLE erp.manufacturing_settings ADD FOREIGN KEY (tenant_id, company_id, subcontract_clearing_account_id) REFERENCES erp.accounts (tenant_id, company_id, id);

ALTER TABLE erp.work_order_transactions DROP CONSTRAINT work_order_transactions_kind_valid;
ALTER TABLE erp.work_order_transactions DROP CONSTRAINT work_order_transactions_sign;
ALTER TABLE erp.work_order_transactions ADD CONSTRAINT work_order_transactions_kind_valid CHECK (kind IN ('material_issue', 'material_return', 'labour', 'overhead', 'subcontract', 'output', 'residual'));
ALTER TABLE erp.work_order_transactions ADD CONSTRAINT work_order_transactions_sign CHECK (
  (kind IN ('material_issue', 'labour', 'overhead', 'subcontract') AND value >= 0) OR (kind IN ('material_return', 'output') AND value <= 0) OR kind = 'residual');

CREATE TABLE erp.subcontract_orders (
  tenant_id               uuid          NOT NULL,
  id                      uuid          NOT NULL,
  company_id              uuid          NOT NULL,
  work_order_id           uuid          NOT NULL,
  subcontractor_id        uuid          NOT NULL,
  jobworker_warehouse_id  uuid          NOT NULL,
  source_warehouse_id     uuid          NOT NULL,
  rate_per_unit           numeric(18,4) NOT NULL,
  first_sent_on           date,
  return_due_date         date,
  status                  text          NOT NULL DEFAULT 'open',
  created_by              uuid,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES erp.work_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, subcontractor_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, jobworker_warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, source_warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT subcontract_orders_work_order_unique UNIQUE (tenant_id, work_order_id),
  CONSTRAINT subcontract_orders_rate_valid CHECK (rate_per_unit >= 0),
  CONSTRAINT subcontract_orders_status_valid CHECK (status IN ('open', 'closed', 'cancelled')),
  CONSTRAINT subcontract_orders_warehouses_differ CHECK (jobworker_warehouse_id <> source_warehouse_id)
);

CREATE TABLE erp.subcontract_challans (
  tenant_id          uuid        NOT NULL,
  id                 uuid        NOT NULL,
  company_id         uuid        NOT NULL,
  order_id           uuid        NOT NULL,
  challan_no         text        NOT NULL,
  kind               text        NOT NULL,
  challan_date       date        NOT NULL,
  vehicle_no         text,
  eway_bill_no       text,
  stock_movement_id  uuid        NOT NULL,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES erp.subcontract_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, stock_movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT subcontract_challans_no_unique UNIQUE (tenant_id, company_id, challan_no),
  CONSTRAINT subcontract_challans_kind_valid CHECK (kind IN ('send', 'return'))
);
CREATE TABLE erp.subcontract_challan_lines (
  tenant_id    uuid          NOT NULL,
  id           uuid          NOT NULL,
  challan_id   uuid          NOT NULL,
  line_no      integer       NOT NULL,
  item_id      uuid          NOT NULL,
  quantity     numeric(18,6) NOT NULL,
  batch_id     uuid,
  serial_nos   text[],
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, challan_id) REFERENCES erp.subcontract_challans (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id, batch_id) REFERENCES erp.batches (tenant_id, item_id, id),
  CONSTRAINT subcontract_challan_lines_no_unique UNIQUE (tenant_id, challan_id, line_no),
  CONSTRAINT subcontract_challan_lines_valid CHECK (quantity > 0)
);
CREATE INDEX subcontract_challans_order_idx ON erp.subcontract_challans (tenant_id, order_id);

CREATE FUNCTION erp.guard_subcontract_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status <> 'open'
     OR (to_jsonb(NEW) - 'status' - 'first_sent_on' - 'return_due_date') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'first_sent_on' - 'return_due_date')
     OR (OLD.first_sent_on IS NOT NULL AND NEW.first_sent_on IS DISTINCT FROM OLD.first_sent_on) THEN
    RAISE EXCEPTION 'a subcontract order only moves its status and its first-sent date (once); it is final once closed or cancelled' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER subcontract_orders_guard BEFORE UPDATE OR DELETE ON erp.subcontract_orders FOR EACH ROW EXECUTE FUNCTION erp.guard_subcontract_order();
CREATE TRIGGER subcontract_challans_immutable BEFORE UPDATE OR DELETE ON erp.subcontract_challans FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER subcontract_challan_lines_immutable BEFORE UPDATE OR DELETE ON erp.subcontract_challan_lines FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subcontract_orders', 'subcontract_challans', 'subcontract_challan_lines'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.subcontract_orders, erp.subcontract_challans, erp.subcontract_challan_lines TO erp_app;
GRANT UPDATE (status, first_sent_on, return_due_date) ON erp.subcontract_orders TO erp_app;
