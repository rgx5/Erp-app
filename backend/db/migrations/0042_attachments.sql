-- Files attached to records: a photo of an item, a scanned supplier bill, a purchase order copy. Stored in the database so they are backed up,
-- restored and kept apart per business exactly like everything else.
CREATE TABLE erp.attachments (
  tenant_id    uuid        NOT NULL REFERENCES erp.tenants (id),
  id           uuid        NOT NULL,
  entity_type  text        NOT NULL,
  entity_id    uuid        NOT NULL,
  kind         text        NOT NULL DEFAULT 'file',
  filename     text        NOT NULL,
  content_type text        NOT NULL,
  size_bytes   integer     NOT NULL,
  sha256       text        NOT NULL,
  data         bytea       NOT NULL,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT attachments_entity_valid CHECK (entity_type IN ('item', 'party', 'sales_invoice', 'sales_order', 'sales_quote', 'purchase_order', 'supplier_bill', 'expense_voucher')),
  CONSTRAINT attachments_kind_valid CHECK (kind IN ('file', 'photo')),
  CONSTRAINT attachments_type_valid CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  CONSTRAINT attachments_size_valid CHECK (size_bytes > 0 AND size_bytes = octet_length(data) AND size_bytes <= 8388608),
  CONSTRAINT attachments_name_valid CHECK (btrim(filename) <> '' AND length(filename) <= 200)
);
CREATE INDEX attachments_entity_idx ON erp.attachments (tenant_id, entity_type, entity_id, created_at);
ALTER TABLE erp.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.attachments TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT, DELETE ON erp.attachments TO erp_app;
