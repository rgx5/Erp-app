-- Variants: items that are sizes or colours of one style. Each variant stays an ordinary item (its own stock, barcode and price);
-- style, size and colour only group and describe them.
ALTER TABLE erp.items ADD COLUMN style_code text;
ALTER TABLE erp.items ADD COLUMN size text;
ALTER TABLE erp.items ADD COLUMN colour text;
ALTER TABLE erp.items ADD CONSTRAINT items_variant_text_valid CHECK ((style_code IS NULL OR btrim(style_code) <> '') AND (size IS NULL OR btrim(size) <> '') AND (colour IS NULL OR btrim(colour) <> ''));
CREATE INDEX items_style_idx ON erp.items (tenant_id, lower(style_code)) WHERE style_code IS NOT NULL;
