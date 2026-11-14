-- GST returns: per-registration return settings (the composition rate). The returns themselves are computed from invoices and
-- supplier bills on demand; nothing about them is stored.
CREATE TABLE erp.gst_return_settings (
  tenant_id            uuid         NOT NULL,
  company_id           uuid         NOT NULL,
  gst_registration_id  uuid         NOT NULL,
  composition_rate     numeric(7,4),
  version              integer      NOT NULL DEFAULT 1,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, gst_registration_id),
  FOREIGN KEY (tenant_id, company_id, gst_registration_id) REFERENCES erp.gst_registrations (tenant_id, company_id, id),
  CONSTRAINT gst_return_settings_rate CHECK (composition_rate IS NULL OR (composition_rate > 0 AND composition_rate <= 100))
);
CREATE TRIGGER gst_return_settings_touch BEFORE UPDATE ON erp.gst_return_settings FOR EACH ROW EXECUTE FUNCTION erp.touch_row();
ALTER TABLE erp.gst_return_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.gst_return_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.gst_return_settings TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON erp.gst_return_settings TO erp_app;
