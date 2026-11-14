-- Stock revaluation: a value-only movement (quantity 0) that adds cost to stock already held, e.g. non-recoverable tax on a
-- supplier bill or freight and duty (landed cost). It is a normal immutable ledger row; the GL entry (Dr inventory / Cr the
-- document's account) is posted with it. Existing receipts, issues and transfers are untouched.

ALTER TABLE erp.stock_movements DROP CONSTRAINT stock_movements_type_valid;
ALTER TABLE erp.stock_movements ADD CONSTRAINT stock_movements_type_valid CHECK (movement_type IN
  ('opening', 'receipt', 'issue', 'adjustment', 'transfer_dispatch', 'transfer_receipt', 'transfer_direct', 'count_adjustment', 'revaluation'));

ALTER TABLE erp.stock_ledger DROP CONSTRAINT stock_ledger_quantity_nonzero;
ALTER TABLE erp.stock_ledger DROP CONSTRAINT stock_ledger_value_sign;
ALTER TABLE erp.stock_ledger ADD CONSTRAINT stock_ledger_not_empty CHECK (quantity <> 0 OR value <> 0);
ALTER TABLE erp.stock_ledger ADD CONSTRAINT stock_ledger_value_sign CHECK (value = 0 OR quantity = 0 OR sign(value) = sign(quantity));

-- A FIFO cost layer's unit cost may now change, but only in a transaction that also writes a revaluation ledger row for the same
-- item and warehouse; otherwise a layer can only be consumed (remaining), exactly as before.
CREATE OR REPLACE FUNCTION erp.guard_layer() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'remaining' - 'unit_cost') IS DISTINCT FROM (to_jsonb(OLD) - 'remaining' - 'unit_cost') THEN
    RAISE EXCEPTION 'a cost layer can only be consumed (remaining) or revalued, never edited or deleted' USING ERRCODE = '55000';
  END IF;
  IF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost AND NOT EXISTS (
    SELECT 1 FROM erp.stock_ledger l JOIN erp.stock_movements m ON m.tenant_id = l.tenant_id AND m.id = l.movement_id
     WHERE l.tenant_id = NEW.tenant_id AND l.warehouse_id = NEW.warehouse_id AND l.item_id = NEW.item_id AND m.movement_type = 'revaluation' AND l.tx_id = txid_current()) THEN
    RAISE EXCEPTION 'a cost layer is revalued only together with a revaluation movement' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
GRANT UPDATE (unit_cost) ON erp.stock_layers TO erp_app;

-- Which ledger row a goods-receipt line created (needed to revalue its FIFO layer), and the account for landed cost that
-- relates to units already sold or consumed.
ALTER TABLE erp.goods_receipt_lines ADD COLUMN stock_ledger_id uuid;
ALTER TABLE erp.goods_receipt_lines ADD FOREIGN KEY (tenant_id, stock_ledger_id) REFERENCES erp.stock_ledger (tenant_id, id);
ALTER TABLE erp.purchasing_settings ADD COLUMN cost_variance_account_id uuid;
ALTER TABLE erp.purchasing_settings ADD FOREIGN KEY (tenant_id, company_id, cost_variance_account_id) REFERENCES erp.accounts (tenant_id, company_id, id);
