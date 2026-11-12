-- Inventory subledger: stock ledger, balances, FIFO cost layers, batches, serial numbers, and the GL account mapping.
-- The stock ledger is immutable like the journal. Quantities are in the item's BASE unit. Values are in the company's base
-- currency. Every movement that changes value is posted to the general ledger in the same transaction by the application, and a
-- reconciliation report proves the subledger and the GL control accounts agree.

-- ---------------------------------------------------------------------------------------------------------------------
-- Items gain a costing method (stocked items only). Existing rows are backfilled; RLS is lifted for the backfill only, inside
-- this migration's transaction, by the table owner.
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE erp.items ADD COLUMN costing_method text;
ALTER TABLE erp.items NO FORCE ROW LEVEL SECURITY;
UPDATE erp.items SET costing_method = 'weighted_average' WHERE is_stocked;
ALTER TABLE erp.items FORCE ROW LEVEL SECURITY;
ALTER TABLE erp.items ADD CONSTRAINT items_costing_valid CHECK (costing_method IS NULL OR costing_method IN ('weighted_average', 'fifo'));
ALTER TABLE erp.items ADD CONSTRAINT items_costing_iff_stocked CHECK (is_stocked = (costing_method IS NOT NULL));

ALTER TABLE erp.warehouses ADD COLUMN allow_negative_stock boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION erp.reject_ledger_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is immutable: % is not allowed (post an opposite movement instead)', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END
$$;

-- Which GL account holds the stock of each item type, and the accounts used when no document supplies one.
CREATE TABLE erp.company_stock_settings (
  tenant_id                   uuid        NOT NULL,
  company_id                  uuid        NOT NULL,
  adjustment_account_id       uuid,
  opening_balance_account_id  uuid,
  version                     integer     NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, adjustment_account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, opening_balance_account_id) REFERENCES erp.accounts (tenant_id, company_id, id)
);

CREATE TABLE erp.inventory_accounts (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL,
  company_id  uuid        NOT NULL,
  item_type   text        NOT NULL,
  account_id  uuid        NOT NULL,
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES erp.accounts (tenant_id, company_id, id),
  CONSTRAINT inventory_accounts_unique UNIQUE (tenant_id, company_id, item_type),
  CONSTRAINT inventory_accounts_type_valid CHECK (item_type IN ('raw_material', 'packing_material', 'semi_finished', 'finished_good', 'trading_good', 'consumable'))
);
-- The account must be a postable asset account marked as a stock control account (inventory or work in progress).
CREATE FUNCTION erp.check_inventory_account() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  a record;
BEGIN
  SELECT type, is_group, control_kind INTO a FROM erp.accounts WHERE tenant_id = NEW.tenant_id AND id = NEW.account_id;
  IF a.type <> 'asset' OR a.is_group OR a.control_kind IS NULL OR a.control_kind NOT IN ('inventory', 'work_in_progress') THEN
    RAISE EXCEPTION 'a stock account must be a postable asset account marked as an inventory or work-in-progress control account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER inventory_accounts_check BEFORE INSERT OR UPDATE ON erp.inventory_accounts FOR EACH ROW EXECUTE FUNCTION erp.check_inventory_account();
CREATE TRIGGER inventory_accounts_touch BEFORE UPDATE ON erp.inventory_accounts FOR EACH ROW EXECUTE FUNCTION erp.touch_row();
CREATE TRIGGER company_stock_settings_touch BEFORE UPDATE ON erp.company_stock_settings FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.batches (
  tenant_id         uuid        NOT NULL,
  id                uuid        NOT NULL,
  item_id           uuid        NOT NULL,
  batch_no          text        NOT NULL,
  manufacture_date  date,
  expiry_date       date,
  status            text        NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  CONSTRAINT batches_item_key UNIQUE (tenant_id, item_id, id),
  CONSTRAINT batches_no_unique UNIQUE (tenant_id, item_id, batch_no),
  CONSTRAINT batches_no_format CHECK (batch_no ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
  CONSTRAINT batches_dates_valid CHECK (expiry_date IS NULL OR manufacture_date IS NULL OR expiry_date >= manufacture_date),
  CONSTRAINT batches_status_valid CHECK (status IN ('active', 'blocked'))
);
-- Only the status of a batch may change.
CREATE FUNCTION erp.guard_batch() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'a batch''s number and dates cannot change; only its status' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER batches_guard BEFORE UPDATE OR DELETE ON erp.batches FOR EACH ROW EXECUTE FUNCTION erp.guard_batch();

CREATE TABLE erp.stock_counters (
  tenant_id       uuid        NOT NULL,
  company_id      uuid        NOT NULL,
  fiscal_year_id  uuid        NOT NULL,
  prefix          text        NOT NULL,
  next_value      bigint      NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, company_id, fiscal_year_id, prefix),
  FOREIGN KEY (tenant_id, company_id, fiscal_year_id) REFERENCES erp.fiscal_years (tenant_id, company_id, id)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Movements and the stock ledger (immutable).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.stock_movements (
  tenant_id         uuid        NOT NULL,
  id                uuid        NOT NULL,
  company_id        uuid        NOT NULL,
  movement_no       text        NOT NULL,
  movement_type     text        NOT NULL,
  posting_date      date        NOT NULL,
  description       text        NOT NULL,
  source_type       text        NOT NULL DEFAULT 'manual',
  source_id         text,
  source_event      text        NOT NULL DEFAULT 'post',
  journal_entry_id  uuid,
  posted_by         uuid,
  posted_at         timestamptz NOT NULL DEFAULT now(),
  tx_id             bigint      NOT NULL DEFAULT txid_current(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, journal_entry_id) REFERENCES erp.journal_entries (tenant_id, id),
  FOREIGN KEY (tenant_id, posted_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT stock_movements_company_key UNIQUE (tenant_id, company_id, id),
  CONSTRAINT stock_movements_no_unique UNIQUE (tenant_id, company_id, movement_no),
  CONSTRAINT stock_movements_type_valid CHECK (movement_type IN
    ('opening', 'receipt', 'issue', 'adjustment', 'transfer_dispatch', 'transfer_receipt', 'transfer_direct', 'count_adjustment')),
  CONSTRAINT stock_movements_description_not_blank CHECK (btrim(description) <> '')
);
CREATE UNIQUE INDEX stock_movements_source_unique ON erp.stock_movements (tenant_id, source_type, source_id, source_event) WHERE source_id IS NOT NULL;
CREATE INDEX stock_movements_date_idx ON erp.stock_movements (tenant_id, company_id, posting_date, id);

CREATE TABLE erp.stock_ledger (
  tenant_id         uuid          NOT NULL,
  id                uuid          NOT NULL,
  movement_id       uuid          NOT NULL,
  company_id        uuid          NOT NULL,
  line_no           integer       NOT NULL,
  warehouse_id      uuid          NOT NULL,
  item_id           uuid          NOT NULL,
  batch_id          uuid,
  posting_date      date          NOT NULL,
  quantity          numeric(18,6) NOT NULL,
  unit_cost         numeric(18,6) NOT NULL,
  value             numeric(18,4) NOT NULL,
  balance_quantity  numeric(18,6) NOT NULL,
  balance_value     numeric(18,4) NOT NULL,
  tx_id             bigint        NOT NULL DEFAULT txid_current(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, movement_id) REFERENCES erp.stock_movements (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id, batch_id) REFERENCES erp.batches (tenant_id, item_id, id),
  CONSTRAINT stock_ledger_line_unique UNIQUE (tenant_id, movement_id, line_no),
  CONSTRAINT stock_ledger_quantity_nonzero CHECK (quantity <> 0),
  CONSTRAINT stock_ledger_cost_valid CHECK (unit_cost >= 0),
  CONSTRAINT stock_ledger_value_sign CHECK (value = 0 OR sign(value) = sign(quantity))
);
CREATE INDEX stock_ledger_item_idx ON erp.stock_ledger (tenant_id, item_id, warehouse_id, posting_date, id);
CREATE INDEX stock_ledger_company_date_idx ON erp.stock_ledger (tenant_id, company_id, posting_date);

CREATE TABLE erp.stock_serials (
  tenant_id         uuid        NOT NULL,
  id                uuid        NOT NULL,
  item_id           uuid        NOT NULL,
  serial_no         text        NOT NULL,
  warehouse_id      uuid        NOT NULL,
  status            text        NOT NULL DEFAULT 'in_stock',
  receipt_ledger_id uuid        NOT NULL,
  issue_ledger_id   uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, receipt_ledger_id) REFERENCES erp.stock_ledger (tenant_id, id),
  FOREIGN KEY (tenant_id, issue_ledger_id) REFERENCES erp.stock_ledger (tenant_id, id),
  CONSTRAINT stock_serials_unique UNIQUE (tenant_id, item_id, serial_no),
  CONSTRAINT stock_serials_no_format CHECK (serial_no ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,59}$'),
  CONSTRAINT stock_serials_status_valid CHECK (status IN ('in_stock', 'issued')),
  CONSTRAINT stock_serials_issue_consistent CHECK ((status = 'issued') = (issue_ledger_id IS NOT NULL))
);
-- A serial's identity never changes; it moves (warehouse) and is issued (status).
CREATE FUNCTION erp.guard_serial() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'warehouse_id' - 'status' - 'issue_ledger_id' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'warehouse_id' - 'status' - 'issue_ledger_id' - 'updated_at') THEN
    RAISE EXCEPTION 'a serial number record cannot be edited or deleted, only moved or issued' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER stock_serials_guard BEFORE UPDATE OR DELETE ON erp.stock_serials FOR EACH ROW EXECUTE FUNCTION erp.guard_serial();

CREATE TABLE erp.stock_ledger_serials (
  tenant_id  uuid NOT NULL,
  ledger_id  uuid NOT NULL,
  serial_id  uuid NOT NULL,
  PRIMARY KEY (tenant_id, ledger_id, serial_id),
  FOREIGN KEY (tenant_id, ledger_id) REFERENCES erp.stock_ledger (tenant_id, id),
  FOREIGN KEY (tenant_id, serial_id) REFERENCES erp.stock_serials (tenant_id, id)
);

-- Current quantity and value per item per warehouse. A cache of the ledger, locked row-by-row to serialise movements of the same
-- stock; a test proves it always equals the sum of the ledger.
CREATE TABLE erp.stock_balances (
  tenant_id     uuid          NOT NULL,
  company_id    uuid          NOT NULL,
  warehouse_id  uuid          NOT NULL,
  item_id       uuid          NOT NULL,
  quantity      numeric(18,6) NOT NULL DEFAULT 0,
  value         numeric(18,4) NOT NULL DEFAULT 0,
  last_cost     numeric(18,6) NOT NULL DEFAULT 0,
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, warehouse_id, item_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  -- (A balance can hold a small residual value at zero quantity only after negative stock was allowed and later covered.)
  CONSTRAINT stock_balances_cost_valid CHECK (last_cost >= 0)
);

CREATE TABLE erp.batch_balances (
  tenant_id     uuid          NOT NULL,
  warehouse_id  uuid          NOT NULL,
  item_id       uuid          NOT NULL,
  batch_id      uuid          NOT NULL,
  quantity      numeric(18,6) NOT NULL DEFAULT 0,
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, warehouse_id, item_id, batch_id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id, batch_id) REFERENCES erp.batches (tenant_id, item_id, id),
  CONSTRAINT batch_balances_not_negative CHECK (quantity >= 0)
);

-- FIFO cost layers: one per receipt; consumed oldest first.
CREATE TABLE erp.stock_layers (
  tenant_id     uuid          NOT NULL,
  id            uuid          NOT NULL,
  company_id    uuid          NOT NULL,
  warehouse_id  uuid          NOT NULL,
  item_id       uuid          NOT NULL,
  ledger_id     uuid          NOT NULL,
  received_on   date          NOT NULL,
  quantity      numeric(18,6) NOT NULL,
  remaining     numeric(18,6) NOT NULL,
  unit_cost     numeric(18,6) NOT NULL,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES erp.warehouses (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, ledger_id) REFERENCES erp.stock_ledger (tenant_id, id),
  CONSTRAINT stock_layers_range CHECK (quantity > 0 AND remaining >= 0 AND remaining <= quantity AND unit_cost >= 0)
);
CREATE INDEX stock_layers_open_idx ON erp.stock_layers (tenant_id, warehouse_id, item_id, received_on, id) WHERE remaining > 0;
CREATE FUNCTION erp.guard_layer() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'remaining') IS DISTINCT FROM (to_jsonb(OLD) - 'remaining') THEN
    RAISE EXCEPTION 'a cost layer can only be consumed (remaining), never edited or deleted' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER stock_layers_guard BEFORE UPDATE OR DELETE ON erp.stock_layers FOR EACH ROW EXECUTE FUNCTION erp.guard_layer();

CREATE TABLE erp.stock_layer_consumptions (
  tenant_id       uuid          NOT NULL,
  id              uuid          NOT NULL,
  issue_ledger_id uuid          NOT NULL,
  layer_id        uuid          NOT NULL,
  quantity        numeric(18,6) NOT NULL,
  unit_cost       numeric(18,6) NOT NULL,
  value           numeric(18,4) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, issue_ledger_id) REFERENCES erp.stock_ledger (tenant_id, id),
  FOREIGN KEY (tenant_id, layer_id) REFERENCES erp.stock_layers (tenant_id, id),
  CONSTRAINT stock_layer_consumptions_qty CHECK (quantity > 0)
);

-- Immutability and same-transaction rules for the ledger.
-- A movement is immutable, with one exception: the posting transaction links the journal entry it created (NULL -> value, same
-- transaction). The link is needed because the entry's amounts are only known after the stock lines are costed.
CREATE FUNCTION erp.guard_stock_movement() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR OLD.journal_entry_id IS NOT NULL
     OR NEW.journal_entry_id IS NULL
     OR OLD.tx_id <> txid_current()
     OR (to_jsonb(NEW) - 'journal_entry_id') IS DISTINCT FROM (to_jsonb(OLD) - 'journal_entry_id') THEN
    RAISE EXCEPTION 'stock_movements is immutable (only the posting transaction may link its journal entry once)' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER stock_movements_guard BEFORE UPDATE OR DELETE ON erp.stock_movements FOR EACH ROW EXECUTE FUNCTION erp.guard_stock_movement();
CREATE TRIGGER stock_ledger_immutable BEFORE UPDATE OR DELETE ON erp.stock_ledger FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER stock_ledger_serials_immutable BEFORE UPDATE OR DELETE ON erp.stock_ledger_serials FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER stock_layer_consumptions_immutable BEFORE UPDATE OR DELETE ON erp.stock_layer_consumptions FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON erp.stock_movements FOR EACH STATEMENT EXECUTE FUNCTION erp.reject_ledger_change();
CREATE TRIGGER stock_ledger_no_truncate BEFORE TRUNCATE ON erp.stock_ledger FOR EACH STATEMENT EXECUTE FUNCTION erp.reject_ledger_change();

CREATE FUNCTION erp.check_stock_ledger_line() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  m record;
BEGIN
  SELECT tx_id, posting_date INTO m FROM erp.stock_movements WHERE tenant_id = NEW.tenant_id AND id = NEW.movement_id;
  IF NOT FOUND OR m.tx_id <> txid_current() THEN
    RAISE EXCEPTION 'ledger lines can only be added in the transaction that creates their movement' USING ERRCODE = '55000';
  END IF;
  IF NEW.posting_date <> m.posting_date THEN
    RAISE EXCEPTION 'a ledger line must carry its movement''s posting date' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER stock_ledger_check BEFORE INSERT ON erp.stock_ledger FOR EACH ROW EXECUTE FUNCTION erp.check_stock_ledger_line();

-- Costing method and stock-affecting item attributes freeze once the item has any stock history.
CREATE OR REPLACE FUNCTION erp.guard_item_identity() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.item_type <> OLD.item_type OR NEW.base_uom_id <> OLD.base_uom_id OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'an item''s code, type and base unit cannot be changed; create a new item' USING ERRCODE = '55000';
  END IF;
  IF (NEW.costing_method IS DISTINCT FROM OLD.costing_method OR NEW.tracking <> OLD.tracking OR NEW.is_stocked <> OLD.is_stocked)
     AND EXISTS (SELECT 1 FROM erp.stock_ledger WHERE tenant_id = NEW.tenant_id AND item_id = NEW.id) THEN
    RAISE EXCEPTION 'an item''s costing method and tracking cannot change once it has stock movements' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------------------------------------------------
DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_stock_settings', 'inventory_accounts', 'batches', 'stock_counters', 'stock_movements', 'stock_ledger', 'stock_serials',
                           'stock_ledger_serials', 'stock_balances', 'batch_balances', 'stock_layers', 'stock_layer_consumptions'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.company_stock_settings, erp.inventory_accounts, erp.stock_counters, erp.stock_balances, erp.batch_balances TO erp_app;
GRANT UPDATE (journal_entry_id) ON erp.stock_movements TO erp_app;
GRANT SELECT, INSERT ON erp.batches, erp.stock_movements, erp.stock_ledger, erp.stock_ledger_serials, erp.stock_layer_consumptions TO erp_app;
GRANT UPDATE (status) ON erp.batches TO erp_app;
GRANT SELECT, INSERT ON erp.stock_serials, erp.stock_layers TO erp_app;
GRANT UPDATE (warehouse_id, status, issue_ledger_id, updated_at) ON erp.stock_serials TO erp_app;
GRANT UPDATE (remaining) ON erp.stock_layers TO erp_app;
GRANT UPDATE (allow_negative_stock) ON erp.warehouses TO erp_app;
