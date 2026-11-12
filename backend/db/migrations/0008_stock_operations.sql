-- Stock operations built on the stock ledger: reservations, warehouse transfers (direct and via an in-transit warehouse) and
-- physical stock counts. None of them changes stock directly: each calls the one stock-movement entry point, so the ledger,
-- balances and general ledger stay in agreement.

CREATE TABLE erp.stock_reservations (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  company_id         uuid          NOT NULL,
  warehouse_id       uuid          NOT NULL,
  item_id            uuid          NOT NULL,
  batch_id           uuid,
  quantity           numeric(18,6) NOT NULL,
  consumed_quantity  numeric(18,6) NOT NULL DEFAULT 0,
  status             text          NOT NULL DEFAULT 'active',
  reference_type     text          NOT NULL,
  reference_id       text          NOT NULL,
  expires_at         timestamptz,
  released_at        timestamptz,
  created_by         uuid,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id, batch_id) REFERENCES erp.batches (tenant_id, item_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT stock_reservations_range CHECK (quantity > 0 AND consumed_quantity >= 0 AND consumed_quantity <= quantity),
  CONSTRAINT stock_reservations_status_valid CHECK (status IN ('active', 'fulfilled', 'released')),
  CONSTRAINT stock_reservations_reference_not_blank CHECK (btrim(reference_type) <> '' AND btrim(reference_id) <> '')
);
CREATE INDEX stock_reservations_open_idx ON erp.stock_reservations (tenant_id, warehouse_id, item_id) WHERE status = 'active';
CREATE INDEX stock_reservations_ref_idx ON erp.stock_reservations (tenant_id, reference_type, reference_id);

CREATE TABLE erp.stock_transfers (
  tenant_id             uuid        NOT NULL,
  id                    uuid        NOT NULL,
  company_id            uuid        NOT NULL,
  transfer_no           text        NOT NULL,
  from_warehouse_id     uuid        NOT NULL,
  to_warehouse_id       uuid        NOT NULL,
  transit_warehouse_id  uuid,
  status                text        NOT NULL,
  posting_date          date        NOT NULL,
  description           text        NOT NULL,
  created_by            uuid,
  version               integer     NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, from_warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, to_warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, transit_warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT stock_transfers_no_unique UNIQUE (tenant_id, company_id, transfer_no),
  CONSTRAINT stock_transfers_distinct CHECK (from_warehouse_id <> to_warehouse_id AND (transit_warehouse_id IS NULL OR (transit_warehouse_id <> from_warehouse_id AND transit_warehouse_id <> to_warehouse_id))),
  CONSTRAINT stock_transfers_status_valid CHECK (status IN ('completed', 'in_transit', 'partially_received', 'cancelled')),
  -- A transfer with no transit warehouse is direct and therefore completed at once.
  CONSTRAINT stock_transfers_direct_complete CHECK (transit_warehouse_id IS NOT NULL OR status = 'completed')
);

CREATE TABLE erp.stock_transfer_lines (
  tenant_id            uuid          NOT NULL,
  id                   uuid          NOT NULL,
  transfer_id          uuid          NOT NULL,
  line_no              integer       NOT NULL,
  item_id              uuid          NOT NULL,
  batch_id             uuid,
  quantity             numeric(18,6) NOT NULL,
  received_quantity    numeric(18,6) NOT NULL DEFAULT 0,
  serial_nos           text[],
  received_serial_nos  text[]        NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, transfer_id) REFERENCES erp.stock_transfers (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id, batch_id) REFERENCES erp.batches (tenant_id, item_id, id),
  CONSTRAINT stock_transfer_lines_no_unique UNIQUE (tenant_id, transfer_id, line_no),
  CONSTRAINT stock_transfer_lines_range CHECK (quantity > 0 AND received_quantity >= 0 AND received_quantity <= quantity)
);

CREATE TABLE erp.stock_counts (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL,
  company_id    uuid        NOT NULL,
  count_no      text        NOT NULL,
  warehouse_id  uuid        NOT NULL,
  count_date    date        NOT NULL,
  description   text        NOT NULL,
  status        text        NOT NULL DEFAULT 'open',
  movement_id   uuid,
  created_by    uuid,
  version       integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, movement_id) REFERENCES erp.stock_movements (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT stock_counts_no_unique UNIQUE (tenant_id, company_id, count_no),
  CONSTRAINT stock_counts_status_valid CHECK (status IN ('open', 'posted', 'cancelled'))
);

CREATE TABLE erp.stock_count_lines (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  count_id           uuid          NOT NULL,
  item_id            uuid          NOT NULL,
  batch_id           uuid,
  snapshot_quantity  numeric(18,6) NOT NULL,
  counted_quantity   numeric(18,6),
  unit_cost          numeric(18,6),
  system_quantity    numeric(18,6),
  variance           numeric(18,6),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, count_id) REFERENCES erp.stock_counts (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id, batch_id) REFERENCES erp.batches (tenant_id, item_id, id),
  CONSTRAINT stock_count_lines_nonneg CHECK (snapshot_quantity >= 0 AND (counted_quantity IS NULL OR counted_quantity >= 0) AND (unit_cost IS NULL OR unit_cost >= 0))
);
CREATE UNIQUE INDEX stock_count_lines_unique ON erp.stock_count_lines (tenant_id, count_id, item_id, COALESCE(batch_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Once a count or transfer has left its working state its lines are frozen.
CREATE FUNCTION erp.guard_count_line() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  s text;
BEGIN
  SELECT status INTO s FROM erp.stock_counts WHERE tenant_id = OLD.tenant_id AND id = OLD.count_id;
  IF s <> 'open' AND (TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'system_quantity' - 'variance') IS DISTINCT FROM (to_jsonb(OLD) - 'system_quantity' - 'variance') OR OLD.system_quantity IS NOT NULL) THEN
    RAISE EXCEPTION 'the lines of a % stock count cannot change', s USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER stock_count_lines_guard BEFORE UPDATE OR DELETE ON erp.stock_count_lines FOR EACH ROW EXECUTE FUNCTION erp.guard_count_line();

CREATE TRIGGER stock_transfers_touch BEFORE UPDATE ON erp.stock_transfers FOR EACH ROW EXECUTE FUNCTION erp.touch_row();
CREATE TRIGGER stock_counts_touch BEFORE UPDATE ON erp.stock_counts FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_reservations', 'stock_transfers', 'stock_transfer_lines', 'stock_counts', 'stock_count_lines'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.stock_reservations, erp.stock_transfers, erp.stock_transfer_lines, erp.stock_counts, erp.stock_count_lines TO erp_app;
GRANT UPDATE (consumed_quantity, status, released_at, updated_at) ON erp.stock_reservations TO erp_app;
GRANT UPDATE (status) ON erp.stock_transfers TO erp_app;
GRANT UPDATE (received_quantity, received_serial_nos) ON erp.stock_transfer_lines TO erp_app;
GRANT UPDATE (status, movement_id) ON erp.stock_counts TO erp_app;
GRANT UPDATE (counted_quantity, unit_cost, system_quantity, variance) ON erp.stock_count_lines TO erp_app;
