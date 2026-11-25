-- Rates agreed with one customer (what we sell to them at) or one supplier (what we buy from them at), per item. When a document for that party is
-- started, the price of an item is suggested from here first, then from what the party was last charged, then from the price list.
CREATE TABLE erp.party_item_rates (
  tenant_id      uuid          NOT NULL REFERENCES erp.tenants (id),
  id             uuid          NOT NULL,
  party_id       uuid          NOT NULL,
  item_id        uuid          NOT NULL,
  rate           numeric(18,4) NOT NULL,
  tax_inclusive  boolean       NOT NULL DEFAULT false,
  status         text          NOT NULL DEFAULT 'active',
  created_by     uuid,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  updated_at     timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES erp.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  CONSTRAINT party_item_rate_value CHECK (rate >= 0),
  CONSTRAINT party_item_rate_status CHECK (status IN ('active', 'inactive'))
);
CREATE UNIQUE INDEX party_item_rate_unique ON erp.party_item_rates (tenant_id, party_id, item_id);
CREATE INDEX party_item_rate_item ON erp.party_item_rates (tenant_id, item_id);
ALTER TABLE erp.party_item_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.party_item_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.party_item_rates TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON erp.party_item_rates TO erp_app;
