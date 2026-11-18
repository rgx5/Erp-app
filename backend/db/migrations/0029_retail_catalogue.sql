-- Retail catalogue: item categories (with a "no discount" rule the counter honours), brand and MRP on items, and barcodes.
-- A barcode is a scannable alias for one item; it is unique across the business and is switched off, never deleted.

CREATE TABLE erp.item_categories (
  tenant_id   uuid        NOT NULL REFERENCES erp.tenants (id),
  id          uuid        NOT NULL,
  code        text        NOT NULL,
  name        text        NOT NULL,
  parent_id   uuid,
  no_discount boolean     NOT NULL DEFAULT false,
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES erp.item_categories (tenant_id, id),
  CONSTRAINT item_categories_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,29}$'),
  CONSTRAINT item_categories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT item_categories_status_valid CHECK (status IN ('active', 'inactive')),
  CONSTRAINT item_categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE UNIQUE INDEX item_categories_code_unique ON erp.item_categories (tenant_id, lower(code));

ALTER TABLE erp.items ADD COLUMN category_id uuid;
ALTER TABLE erp.items ADD COLUMN brand text;
ALTER TABLE erp.items ADD COLUMN mrp numeric(18,4);
ALTER TABLE erp.items ADD FOREIGN KEY (tenant_id, category_id) REFERENCES erp.item_categories (tenant_id, id);
ALTER TABLE erp.items ADD CONSTRAINT items_mrp_valid CHECK (mrp IS NULL OR mrp >= 0);
ALTER TABLE erp.items ADD CONSTRAINT items_brand_not_blank CHECK (brand IS NULL OR btrim(brand) <> '');

CREATE TABLE erp.item_barcodes (
  tenant_id  uuid        NOT NULL REFERENCES erp.tenants (id),
  id         uuid        NOT NULL,
  item_id    uuid        NOT NULL,
  barcode    text        NOT NULL,
  status     text        NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  CONSTRAINT item_barcodes_format CHECK (barcode ~ '^[A-Za-z0-9][A-Za-z0-9._/+-]{3,63}$'),
  CONSTRAINT item_barcodes_status_valid CHECK (status IN ('active', 'inactive'))
);
CREATE UNIQUE INDEX item_barcodes_unique ON erp.item_barcodes (tenant_id, lower(barcode));
CREATE INDEX item_barcodes_item ON erp.item_barcodes (tenant_id, item_id);

CREATE FUNCTION erp.guard_item_barcode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'a barcode is only switched on or off; it is never changed or deleted' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER item_barcodes_guard BEFORE UPDATE OR DELETE ON erp.item_barcodes FOR EACH ROW EXECUTE FUNCTION erp.guard_item_barcode();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['item_categories', 'item_barcodes'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.item_categories TO erp_app;
GRANT SELECT, INSERT ON erp.item_barcodes TO erp_app;
GRANT UPDATE (status) ON erp.item_barcodes TO erp_app;
