-- Master data: currencies, units, tax codes (effective-dated rates), items, parties, price lists.
-- Same rules as before (tenant-aware composite keys, FORCED RLS, no DELETE). Effective-dated tables use EXCLUDE constraints so
-- two periods for the same thing can never overlap, whatever the application does.

-- Shared guard: a row of an effective-dated table can only be CLOSED (effective_to set once, never before effective_from).
-- History is never rewritten: a change is a new row.
CREATE FUNCTION erp.guard_effective_dated() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is append-only: DELETE is not allowed', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF OLD.effective_to IS NOT NULL
     OR NEW.effective_to IS NULL
     OR NEW.effective_to < OLD.effective_from
     OR (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') THEN
    RAISE EXCEPTION '%: an effective-dated row can only be closed once (set effective_to); create a new row to change it', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.currencies (
  tenant_id       uuid        NOT NULL REFERENCES erp.tenants (id),
  id              uuid        NOT NULL,
  code            char(3)     NOT NULL,
  name            text        NOT NULL,
  symbol          text,
  decimal_places  smallint    NOT NULL DEFAULT 2,
  status          text        NOT NULL DEFAULT 'active',
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT currencies_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT currencies_code_format CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT currencies_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT currencies_decimals_valid CHECK (decimal_places BETWEEN 0 AND 4),
  CONSTRAINT currencies_status_valid CHECK (status IN ('active', 'inactive'))
);

-- Rates are facts on a date: immutable. A correction is a new effective date.
CREATE TABLE erp.exchange_rates (
  tenant_id       uuid          NOT NULL,
  id              uuid          NOT NULL,
  from_currency   char(3)       NOT NULL,
  to_currency     char(3)       NOT NULL,
  rate            numeric(18,8) NOT NULL,
  effective_date  date          NOT NULL,
  source          text,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, from_currency) REFERENCES erp.currencies (tenant_id, code),
  FOREIGN KEY (tenant_id, to_currency) REFERENCES erp.currencies (tenant_id, code),
  CONSTRAINT exchange_rates_unique UNIQUE (tenant_id, from_currency, to_currency, effective_date),
  CONSTRAINT exchange_rates_rate_positive CHECK (rate > 0),
  CONSTRAINT exchange_rates_distinct CHECK (from_currency <> to_currency)
);

CREATE TABLE erp.units (
  tenant_id       uuid        NOT NULL REFERENCES erp.tenants (id),
  id              uuid        NOT NULL,
  code            text        NOT NULL,
  name            text        NOT NULL,
  uqc             text,
  decimal_places  smallint    NOT NULL DEFAULT 3,
  status          text        NOT NULL DEFAULT 'active',
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT units_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT units_code_format CHECK (code ~ '^[A-Z0-9]{1,10}$'),
  CONSTRAINT units_name_not_blank CHECK (btrim(name) <> ''),
  -- GST Unique Quantity Codes (the statutory list used in invoices and returns).
  CONSTRAINT units_uqc_valid CHECK (uqc IS NULL OR uqc IN (
    'BAG','BAL','BDL','BKL','BOU','BOX','BTL','BUN','CAN','CBM','CCM','CMS','CTN','DOZ','DRM','GGK','GMS','GRS','GYD','KGS','KLR','KME',
    'MLT','MTR','MTS','NOS','OTH','PAC','PCS','PRS','QTL','ROL','SET','SQF','SQM','SQY','TBS','TGM','THD','TON','TUB','UGS','UNT','YDS')),
  CONSTRAINT units_decimals_valid CHECK (decimal_places BETWEEN 0 AND 6),
  CONSTRAINT units_status_valid CHECK (status IN ('active', 'inactive'))
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Tax codes. The code is a stable name; the RATES are versions with effective dates, so a rate change never rewrites
-- history and a document is always taxed at the rate in force on its own date.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.tax_codes (
  tenant_id   uuid        NOT NULL REFERENCES erp.tenants (id),
  id          uuid        NOT NULL,
  code        text        NOT NULL,
  name        text        NOT NULL,
  kind        text        NOT NULL DEFAULT 'gst',
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT tax_codes_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT tax_codes_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,29}$'),
  CONSTRAINT tax_codes_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT tax_codes_kind_valid CHECK (kind IN ('gst', 'exempt', 'nil_rated', 'non_gst')),
  CONSTRAINT tax_codes_status_valid CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE erp.tax_code_rates (
  tenant_id       uuid         NOT NULL,
  id              uuid         NOT NULL,
  tax_code_id     uuid         NOT NULL,
  effective_from  date         NOT NULL,
  effective_to    date,
  igst_rate       numeric(7,4) NOT NULL DEFAULT 0,
  cgst_rate       numeric(7,4) NOT NULL DEFAULT 0,
  sgst_rate       numeric(7,4) NOT NULL DEFAULT 0,
  cess_rate       numeric(7,4) NOT NULL DEFAULT 0,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, tax_code_id) REFERENCES erp.tax_codes (tenant_id, id),
  CONSTRAINT tax_code_rates_period_valid CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT tax_code_rates_range CHECK (igst_rate BETWEEN 0 AND 100 AND cgst_rate BETWEEN 0 AND 100 AND sgst_rate BETWEEN 0 AND 100 AND cess_rate BETWEEN 0 AND 1000),
  -- Intra-state tax splits evenly between the centre and the state: CGST = SGST = IGST / 2.
  CONSTRAINT tax_code_rates_split CHECK (cgst_rate = sgst_rate AND cgst_rate * 2 = igst_rate),
  CONSTRAINT tax_code_rates_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, tax_code_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
);

-- Only 'gst' codes may carry a rate; exempt / nil-rated / non-GST codes are zero by definition.
CREATE FUNCTION erp.check_tax_rate_kind() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  code_kind text;
BEGIN
  SELECT kind INTO code_kind FROM erp.tax_codes WHERE tenant_id = NEW.tenant_id AND id = NEW.tax_code_id;
  IF code_kind <> 'gst' AND (NEW.igst_rate <> 0 OR NEW.cess_rate <> 0) THEN
    RAISE EXCEPTION 'a % tax code cannot carry a non-zero rate', code_kind USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tax_code_rates_kind BEFORE INSERT ON erp.tax_code_rates FOR EACH ROW EXECUTE FUNCTION erp.check_tax_rate_kind();
CREATE TRIGGER tax_code_rates_guard BEFORE UPDATE OR DELETE ON erp.tax_code_rates FOR EACH ROW EXECUTE FUNCTION erp.guard_effective_dated();

-- ---------------------------------------------------------------------------------------------------------------------
-- Items. Built for manufacturing from the start: raw materials, semi-finished goods and finished goods are first-class types.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.items (
  tenant_id          uuid        NOT NULL REFERENCES erp.tenants (id),
  id                 uuid        NOT NULL,
  code               text        NOT NULL,
  name               text        NOT NULL,
  description        text,
  item_type          text        NOT NULL,
  base_uom_id        uuid        NOT NULL,
  hsn_sac_code       text,
  tax_code_id        uuid,
  tracking           text        NOT NULL DEFAULT 'none',
  is_stocked         boolean     NOT NULL DEFAULT true,
  is_purchasable     boolean     NOT NULL DEFAULT true,
  is_sellable        boolean     NOT NULL DEFAULT true,
  is_manufactured    boolean     NOT NULL DEFAULT false,
  status             text        NOT NULL DEFAULT 'active',
  version            integer     NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, base_uom_id) REFERENCES erp.units (tenant_id, id),
  FOREIGN KEY (tenant_id, tax_code_id) REFERENCES erp.tax_codes (tenant_id, id),
  CONSTRAINT items_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$'),
  CONSTRAINT items_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT items_type_valid CHECK (item_type IN ('raw_material', 'packing_material', 'semi_finished', 'finished_good', 'trading_good', 'consumable', 'service')),
  CONSTRAINT items_tracking_valid CHECK (tracking IN ('none', 'batch', 'serial')),
  CONSTRAINT items_status_valid CHECK (status IN ('active', 'inactive')),
  -- HSN (goods) is 4, 6 or 8 digits; SAC (services) is 6 digits starting 99.
  CONSTRAINT items_hsn_sac_format CHECK (hsn_sac_code IS NULL OR (item_type = 'service' AND hsn_sac_code ~ '^99[0-9]{4}$')
                                                           OR (item_type <> 'service' AND hsn_sac_code ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$')),
  CONSTRAINT items_service_rules CHECK (item_type <> 'service' OR (NOT is_stocked AND tracking = 'none' AND NOT is_manufactured)),
  CONSTRAINT items_tracking_needs_stock CHECK (tracking = 'none' OR is_stocked),
  CONSTRAINT items_manufactured_types CHECK (NOT is_manufactured OR item_type IN ('semi_finished', 'finished_good'))
);
CREATE UNIQUE INDEX items_code_unique ON erp.items (tenant_id, lower(code));
CREATE INDEX items_type_idx ON erp.items (tenant_id, item_type, id);

-- What an item's stock is counted in and what kind of thing it is cannot change once created (stock, costing and BOMs depend on it).
CREATE FUNCTION erp.guard_item_identity() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.item_type <> OLD.item_type OR NEW.base_uom_id <> OLD.base_uom_id OR NEW.code <> OLD.code THEN
    RAISE EXCEPTION 'an item''s code, type and base unit cannot be changed; create a new item' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER items_identity BEFORE UPDATE ON erp.items FOR EACH ROW EXECUTE FUNCTION erp.guard_item_identity();

-- Alternative units for an item: factor = how many BASE units one of this unit contains (a box of 12 -> 12).
CREATE TABLE erp.item_uom_conversions (
  tenant_id  uuid          NOT NULL,
  id         uuid          NOT NULL,
  item_id    uuid          NOT NULL,
  uom_id     uuid          NOT NULL,
  factor     numeric(18,8) NOT NULL,
  created_at timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, uom_id) REFERENCES erp.units (tenant_id, id),
  CONSTRAINT item_uom_unique UNIQUE (tenant_id, item_id, uom_id),
  CONSTRAINT item_uom_factor_positive CHECK (factor > 0)
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Parties: one record per business partner, with roles (a customer can also be a supplier).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.payment_terms (
  tenant_id   uuid        NOT NULL REFERENCES erp.tenants (id),
  id          uuid        NOT NULL,
  code        text        NOT NULL,
  name        text        NOT NULL,
  net_days    integer     NOT NULL,
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT payment_terms_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT payment_terms_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,29}$'),
  CONSTRAINT payment_terms_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT payment_terms_days_valid CHECK (net_days BETWEEN 0 AND 365),
  CONSTRAINT payment_terms_status_valid CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE erp.parties (
  tenant_id          uuid          NOT NULL REFERENCES erp.tenants (id),
  id                 uuid          NOT NULL,
  code               text          NOT NULL,
  legal_name         text          NOT NULL,
  trade_name         text,
  is_customer        boolean       NOT NULL DEFAULT false,
  is_supplier        boolean       NOT NULL DEFAULT false,
  is_subcontractor   boolean       NOT NULL DEFAULT false,
  gst_treatment      text          NOT NULL,
  gstin              char(15),
  pan                text,
  currency           char(3)       NOT NULL DEFAULT 'INR',
  payment_terms_id   uuid,
  credit_limit       numeric(18,4),
  status             text          NOT NULL DEFAULT 'active',
  version            integer       NOT NULL DEFAULT 1,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, currency) REFERENCES erp.currencies (tenant_id, code),
  FOREIGN KEY (tenant_id, payment_terms_id) REFERENCES erp.payment_terms (tenant_id, id),
  CONSTRAINT parties_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,39}$'),
  CONSTRAINT parties_name_not_blank CHECK (btrim(legal_name) <> ''),
  CONSTRAINT parties_has_role CHECK (is_customer OR is_supplier OR is_subcontractor),
  CONSTRAINT parties_treatment_valid CHECK (gst_treatment IN
    ('registered_regular', 'registered_composition', 'sez', 'deemed_export', 'unregistered', 'consumer', 'overseas')),
  CONSTRAINT parties_gstin_format CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  CONSTRAINT parties_gstin_matches_treatment CHECK (
    (gst_treatment IN ('registered_regular', 'registered_composition', 'sez', 'deemed_export')) = (gstin IS NOT NULL)),
  CONSTRAINT parties_pan_format CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  CONSTRAINT parties_pan_matches_gstin CHECK (gstin IS NULL OR pan IS NULL OR substr(gstin, 3, 10) = pan),
  CONSTRAINT parties_credit_limit_valid CHECK (credit_limit IS NULL OR (credit_limit >= 0 AND is_customer)),
  CONSTRAINT parties_status_valid CHECK (status IN ('active', 'inactive', 'blocked'))
);
CREATE UNIQUE INDEX parties_code_unique ON erp.parties (tenant_id, lower(code));
CREATE UNIQUE INDEX parties_gstin_unique ON erp.parties (tenant_id, gstin) WHERE gstin IS NOT NULL;

CREATE TABLE erp.party_addresses (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL,
  party_id    uuid        NOT NULL,
  kind        text        NOT NULL,
  line1       text        NOT NULL,
  line2       text,
  city        text        NOT NULL,
  state_code  char(2)     NOT NULL,
  pincode     char(6),
  country     char(2)     NOT NULL DEFAULT 'IN',
  is_default  boolean     NOT NULL DEFAULT false,
  status      text        NOT NULL DEFAULT 'active',
  version     integer     NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES erp.parties (tenant_id, id),
  CONSTRAINT party_addresses_kind_valid CHECK (kind IN ('billing', 'shipping', 'registered', 'other')),
  CONSTRAINT party_addresses_line1_not_blank CHECK (btrim(line1) <> ''),
  -- Indian addresses: 2-digit GST state code (97 = Other Territory, 96 = Other Country) and a PIN code.
  CONSTRAINT party_addresses_state_format CHECK (state_code ~ '^[0-9]{2}$'),
  CONSTRAINT party_addresses_country_format CHECK (country ~ '^[A-Z]{2}$'),
  CONSTRAINT party_addresses_pincode_rule CHECK ((country = 'IN') = (pincode IS NOT NULL) AND (pincode IS NULL OR pincode ~ '^[1-9][0-9]{5}$')),
  CONSTRAINT party_addresses_status_valid CHECK (status IN ('active', 'inactive'))
);
CREATE INDEX party_addresses_party_idx ON erp.party_addresses (tenant_id, party_id);
CREATE UNIQUE INDEX party_addresses_one_default ON erp.party_addresses (tenant_id, party_id, kind) WHERE is_default AND status = 'active';

-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.price_lists (
  tenant_id      uuid        NOT NULL REFERENCES erp.tenants (id),
  id             uuid        NOT NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  kind           text        NOT NULL,
  currency       char(3)     NOT NULL,
  tax_inclusive  boolean     NOT NULL DEFAULT false,
  status         text        NOT NULL DEFAULT 'active',
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, currency) REFERENCES erp.currencies (tenant_id, code),
  CONSTRAINT price_lists_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT price_lists_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,29}$'),
  CONSTRAINT price_lists_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT price_lists_kind_valid CHECK (kind IN ('sales', 'purchase')),
  CONSTRAINT price_lists_status_valid CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE erp.price_list_items (
  tenant_id       uuid          NOT NULL,
  id              uuid          NOT NULL,
  price_list_id   uuid          NOT NULL,
  item_id         uuid          NOT NULL,
  uom_id          uuid          NOT NULL,
  min_qty         numeric(18,6) NOT NULL DEFAULT 0,
  price           numeric(18,4) NOT NULL,
  effective_from  date          NOT NULL,
  effective_to    date,
  created_at      timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, price_list_id) REFERENCES erp.price_lists (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES erp.items (tenant_id, id),
  FOREIGN KEY (tenant_id, uom_id) REFERENCES erp.units (tenant_id, id),
  CONSTRAINT price_list_items_min_qty_valid CHECK (min_qty >= 0),
  CONSTRAINT price_list_items_price_valid CHECK (price >= 0),
  CONSTRAINT price_list_items_period_valid CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT price_list_items_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, price_list_id WITH =, item_id WITH =, uom_id WITH =, min_qty WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&)
);
CREATE INDEX price_list_items_lookup_idx ON erp.price_list_items (tenant_id, price_list_id, item_id);
CREATE TRIGGER price_list_items_guard BEFORE UPDATE OR DELETE ON erp.price_list_items FOR EACH ROW EXECUTE FUNCTION erp.guard_effective_dated();

-- ---------------------------------------------------------------------------------------------------------------------
DO $t$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['currencies', 'units', 'tax_codes', 'items', 'payment_terms', 'parties', 'party_addresses', 'price_lists'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON erp.%I FOR EACH ROW EXECUTE FUNCTION erp.touch_row()', t || '_touch', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['currencies', 'exchange_rates', 'units', 'tax_codes', 'tax_code_rates', 'items', 'item_uom_conversions',
                           'payment_terms', 'parties', 'party_addresses', 'price_lists', 'price_list_items'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$t$;

GRANT SELECT, INSERT, UPDATE ON erp.currencies, erp.units, erp.tax_codes, erp.items, erp.payment_terms, erp.parties, erp.party_addresses, erp.price_lists TO erp_app;
GRANT SELECT, INSERT ON erp.exchange_rates, erp.item_uom_conversions TO erp_app;
GRANT SELECT, INSERT ON erp.tax_code_rates, erp.price_list_items TO erp_app;
GRANT UPDATE (effective_to) ON erp.tax_code_rates, erp.price_list_items TO erp_app;
