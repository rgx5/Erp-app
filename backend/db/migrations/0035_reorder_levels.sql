-- Reorder levels: the stock quantity at or below which an item should be bought again, and how much to buy.
ALTER TABLE erp.items ADD COLUMN reorder_level numeric(18,6);
ALTER TABLE erp.items ADD COLUMN reorder_qty numeric(18,6);
ALTER TABLE erp.items ADD CONSTRAINT items_reorder_level_valid CHECK (reorder_level IS NULL OR reorder_level >= 0);
ALTER TABLE erp.items ADD CONSTRAINT items_reorder_qty_valid CHECK (reorder_qty IS NULL OR reorder_qty >= 0);
