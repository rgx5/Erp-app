-- What each tenant has licensed: modules, numeric limits, an optional expiry and a read-only switch (suspension). A tenant with no row is
-- unrestricted, so existing tenants and development databases keep working. Written by the platform (control plane or a site's licence import).
CREATE TABLE erp.tenant_entitlements (
  tenant_id  uuid        PRIMARY KEY REFERENCES erp.tenants (id),
  plan       text,
  modules    text[]      NOT NULL DEFAULT '{}',
  limits     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  read_only  boolean     NOT NULL DEFAULT false,
  expires_at timestamptz,
  grace_days integer     NOT NULL DEFAULT 14,
  licence_id text,
  source     text        NOT NULL DEFAULT 'platform',
  version    integer     NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_entitlements_grace_valid CHECK (grace_days >= 0 AND grace_days <= 365),
  CONSTRAINT tenant_entitlements_source_valid CHECK (source IN ('platform', 'licence'))
);

ALTER TABLE erp.tenant_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.tenant_entitlements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.tenant_entitlements TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON erp.tenant_entitlements TO erp_app;
