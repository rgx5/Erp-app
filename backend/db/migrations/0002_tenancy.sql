-- Tenancy hierarchy:  Tenant -> Company -> GST registration -> Business location -> Warehouse
--
-- Rules every table here follows (and a test enforces for all future tables):
--   * primary key (tenant_id, id): the tenant is part of every row's identity;
--   * every foreign key is composite and includes tenant_id, so a row can never reference another tenant's row
--     (referential-integrity checks bypass RLS, so this is the only thing that stops a cross-tenant reference);
--   * row-level security is ENABLED and FORCED, with one policy that matches only the current tenant;
--   * the runtime role is granted SELECT/INSERT/UPDATE only. There is no DELETE: organisational units are deactivated.

CREATE TABLE erp.tenants (
  id          uuid        PRIMARY KEY,
  slug        text        NOT NULL,
  name        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenants_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  CONSTRAINT tenants_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT tenants_status_valid CHECK (status IN ('active', 'suspended')),
  CONSTRAINT tenants_slug_unique UNIQUE (slug)
);

CREATE TABLE erp.companies (
  tenant_id                  uuid        NOT NULL REFERENCES erp.tenants (id),
  id                         uuid        NOT NULL,
  legal_name                 text        NOT NULL,
  trade_name                 text,
  pan                        text,
  base_currency              char(3)     NOT NULL DEFAULT 'INR',
  fiscal_year_start_month    smallint    NOT NULL DEFAULT 4,
  status                     text        NOT NULL DEFAULT 'active',
  version                    integer     NOT NULL DEFAULT 1,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT companies_legal_name_not_blank CHECK (btrim(legal_name) <> ''),
  CONSTRAINT companies_pan_format CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT companies_currency_format CHECK (base_currency ~ '^[A-Z]{3}$'),
  CONSTRAINT companies_fy_month_valid CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  CONSTRAINT companies_status_valid CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE erp.gst_registrations (
  tenant_id          uuid        NOT NULL,
  id                 uuid        NOT NULL,
  company_id         uuid        NOT NULL,
  gstin              char(15)    NOT NULL,
  state_code         char(2)     NOT NULL,
  legal_name         text        NOT NULL,
  trade_name         text,
  registration_type  text        NOT NULL DEFAULT 'regular',
  status             text        NOT NULL DEFAULT 'active',
  effective_from     date        NOT NULL,
  effective_to       date,
  version            integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  -- Target of the composite foreign key from business_locations: guarantees a location's GST registration
  -- belongs to the SAME company as the location.
  CONSTRAINT gst_registrations_company_key UNIQUE (tenant_id, company_id, id),
  CONSTRAINT gst_registrations_gstin_unique UNIQUE (tenant_id, gstin),
  CONSTRAINT gst_registrations_gstin_format CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  CONSTRAINT gst_registrations_state_matches_gstin CHECK (substr(gstin, 1, 2) = state_code),
  CONSTRAINT gst_registrations_legal_name_not_blank CHECK (btrim(legal_name) <> ''),
  CONSTRAINT gst_registrations_type_valid CHECK (registration_type IN
    ('regular', 'composition', 'sez_unit', 'sez_developer', 'casual', 'non_resident', 'isd', 'tds', 'tcs', 'ecommerce_operator')),
  CONSTRAINT gst_registrations_status_valid CHECK (status IN ('active', 'suspended', 'cancelled')),
  CONSTRAINT gst_registrations_period_valid CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX gst_registrations_company_idx ON erp.gst_registrations (tenant_id, company_id);

-- The characters 3-12 of a GSTIN are the holder's PAN. When the company has a PAN, they must agree.
CREATE FUNCTION erp.check_gstin_matches_company_pan() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  company_pan text;
BEGIN
  SELECT pan INTO company_pan FROM erp.companies WHERE tenant_id = NEW.tenant_id AND id = NEW.company_id;
  IF company_pan IS NOT NULL AND substr(NEW.gstin, 3, 10) <> company_pan THEN
    RAISE EXCEPTION 'GSTIN % does not belong to the PAN of its company', NEW.gstin
      USING ERRCODE = 'check_violation', CONSTRAINT = 'gst_registrations_gstin_matches_company_pan';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER gst_registrations_pan_check
  BEFORE INSERT OR UPDATE OF gstin, company_id ON erp.gst_registrations
  FOR EACH ROW EXECUTE FUNCTION erp.check_gstin_matches_company_pan();

CREATE TABLE erp.business_locations (
  tenant_id              uuid        NOT NULL,
  id                     uuid        NOT NULL,
  company_id             uuid        NOT NULL,
  -- NULL for a location that is not under any GST registration (for example an unregistered company).
  gst_registration_id    uuid,
  code                   text        NOT NULL,
  name                   text        NOT NULL,
  is_principal_place     boolean     NOT NULL DEFAULT false,
  address_line1          text        NOT NULL,
  address_line2          text,
  city                   text        NOT NULL,
  state_code             char(2)     NOT NULL,
  pincode                char(6)     NOT NULL,
  status                 text        NOT NULL DEFAULT 'active',
  version                integer     NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  -- MATCH SIMPLE: not enforced when gst_registration_id is NULL; when set, the registration must be this company's.
  FOREIGN KEY (tenant_id, company_id, gst_registration_id) REFERENCES erp.gst_registrations (tenant_id, company_id, id),
  CONSTRAINT business_locations_code_unique UNIQUE (tenant_id, company_id, code),
  CONSTRAINT business_locations_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT business_locations_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT business_locations_state_format CHECK (state_code ~ '^[0-9]{2}$'),
  CONSTRAINT business_locations_pincode_format CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  CONSTRAINT business_locations_status_valid CHECK (status IN ('active', 'inactive')),
  CONSTRAINT business_locations_principal_needs_registration CHECK (NOT is_principal_place OR gst_registration_id IS NOT NULL)
);
CREATE INDEX business_locations_company_idx ON erp.business_locations (tenant_id, company_id);
CREATE INDEX business_locations_registration_idx ON erp.business_locations (tenant_id, gst_registration_id)
  WHERE gst_registration_id IS NOT NULL;
CREATE UNIQUE INDEX business_locations_one_principal_idx ON erp.business_locations (tenant_id, gst_registration_id)
  WHERE is_principal_place;

CREATE TABLE erp.warehouses (
  tenant_id              uuid        NOT NULL,
  id                     uuid        NOT NULL,
  business_location_id   uuid        NOT NULL,
  code                   text        NOT NULL,
  name                   text        NOT NULL,
  -- What the warehouse is FOR. Manufacturing needs raw-material, work-in-progress, finished-goods, scrap and
  -- subcontractor stores to be distinct places from day one; inventory valuation and production build on this.
  kind                   text        NOT NULL DEFAULT 'general',
  status                 text        NOT NULL DEFAULT 'active',
  version                integer     NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, business_location_id) REFERENCES erp.business_locations (tenant_id, id),
  CONSTRAINT warehouses_code_unique UNIQUE (tenant_id, business_location_id, code),
  CONSTRAINT warehouses_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT warehouses_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT warehouses_kind_valid CHECK (kind IN
    ('general', 'raw_material', 'work_in_progress', 'finished_goods', 'scrap', 'quarantine', 'in_transit', 'subcontractor')),
  CONSTRAINT warehouses_status_valid CHECK (status IN ('active', 'inactive'))
);
CREATE INDEX warehouses_location_idx ON erp.warehouses (tenant_id, business_location_id);

-- Row versioning on every table.
CREATE TRIGGER tenants_touch BEFORE UPDATE ON erp.tenants FOR EACH ROW EXECUTE FUNCTION erp.touch_row();
CREATE TRIGGER companies_touch BEFORE UPDATE ON erp.companies FOR EACH ROW EXECUTE FUNCTION erp.touch_row();
CREATE TRIGGER gst_registrations_touch BEFORE UPDATE ON erp.gst_registrations FOR EACH ROW EXECUTE FUNCTION erp.touch_row();
CREATE TRIGGER business_locations_touch BEFORE UPDATE ON erp.business_locations FOR EACH ROW EXECUTE FUNCTION erp.touch_row();
CREATE TRIGGER warehouses_touch BEFORE UPDATE ON erp.warehouses FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

-- Row-level security: enabled AND forced, one policy per table, matching only the current tenant.
ALTER TABLE erp.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON erp.tenants TO erp_app
  USING (id = erp.current_tenant_id()) WITH CHECK (id = erp.current_tenant_id());

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies', 'gst_registrations', 'business_locations', 'warehouses'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

-- Explicit, minimal grants for the runtime role. No DELETE.
GRANT SELECT, INSERT, UPDATE ON erp.tenants, erp.companies, erp.gst_registrations, erp.business_locations, erp.warehouses TO erp_app;
