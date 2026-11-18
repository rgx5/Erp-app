-- Customer wallet for the counter: loyalty points, coupons, and a record of what a sale took from (or paid into) a customer's wallet.
-- Store credit has no table of its own: it is the customer's unapplied credit in receivables (an advance receipt or a credit note
-- that has not been used), so it already sits in the books and the customer's statement. Using it allocates it to the new invoice.
-- Points and coupon uses are recorded here and never edited.

CREATE TABLE erp.retail_settings (
  tenant_id                   uuid          NOT NULL REFERENCES erp.tenants (id),
  company_id                  uuid          NOT NULL,
  loyalty_points_per_hundred  numeric(10,4) NOT NULL DEFAULT 0,
  loyalty_rupees_per_point    numeric(10,4) NOT NULL DEFAULT 0,
  version                     integer       NOT NULL DEFAULT 1,
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT retail_settings_rates_valid CHECK (loyalty_points_per_hundred >= 0 AND loyalty_rupees_per_point >= 0)
);

CREATE TABLE erp.loyalty_ledger (
  tenant_id   uuid          NOT NULL REFERENCES erp.tenants (id),
  id          uuid          NOT NULL,
  company_id  uuid          NOT NULL,
  customer_id uuid          NOT NULL,
  points      numeric(18,2) NOT NULL,
  kind        text          NOT NULL,
  ref_type    text,
  ref_id      uuid,
  note        text,
  created_by  uuid,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES erp.parties (tenant_id, id),
  CONSTRAINT loyalty_ledger_points_nonzero CHECK (points <> 0),
  CONSTRAINT loyalty_ledger_kind_valid CHECK (kind IN ('earn', 'redeem', 'adjust')),
  CONSTRAINT loyalty_ledger_sign CHECK ((kind = 'earn' AND points > 0) OR (kind = 'redeem' AND points < 0) OR kind = 'adjust')
);
CREATE INDEX loyalty_ledger_customer ON erp.loyalty_ledger (tenant_id, company_id, customer_id, created_at);
CREATE TRIGGER loyalty_ledger_immutable BEFORE UPDATE OR DELETE ON erp.loyalty_ledger FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

CREATE TABLE erp.coupons (
  tenant_id    uuid          NOT NULL REFERENCES erp.tenants (id),
  id           uuid          NOT NULL,
  company_id   uuid          NOT NULL,
  code         text          NOT NULL,
  description  text,
  kind         text          NOT NULL,
  value        numeric(18,4) NOT NULL,
  min_bill     numeric(18,4) NOT NULL DEFAULT 0,
  max_discount numeric(18,4),
  valid_from   date,
  valid_to     date,
  max_uses     integer,
  used_count   integer       NOT NULL DEFAULT 0,
  status       text          NOT NULL DEFAULT 'active',
  version      integer       NOT NULL DEFAULT 1,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  CONSTRAINT coupons_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$'),
  CONSTRAINT coupons_kind_valid CHECK (kind IN ('percent', 'fixed')),
  CONSTRAINT coupons_value_valid CHECK (value > 0 AND (kind <> 'percent' OR value <= 100)),
  CONSTRAINT coupons_status_valid CHECK (status IN ('active', 'inactive')),
  CONSTRAINT coupons_dates_valid CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CONSTRAINT coupons_uses_valid CHECK (max_uses IS NULL OR max_uses > 0)
);
CREATE UNIQUE INDEX coupons_code_unique ON erp.coupons (tenant_id, company_id, lower(code));

CREATE TABLE erp.coupon_redemptions (
  tenant_id   uuid          NOT NULL REFERENCES erp.tenants (id),
  id          uuid          NOT NULL,
  coupon_id   uuid          NOT NULL,
  pos_sale_id uuid          NOT NULL,
  customer_id uuid,
  bill_total  numeric(18,4) NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, coupon_id) REFERENCES erp.coupons (tenant_id, id),
  FOREIGN KEY (tenant_id, pos_sale_id) REFERENCES erp.pos_sales (tenant_id, id)
);
CREATE TRIGGER coupon_redemptions_immutable BEFORE UPDATE OR DELETE ON erp.coupon_redemptions FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

-- What a counter sale or return moved through the customer's wallet (store credit used or issued, points redeemed or earned, coupon).
CREATE TABLE erp.pos_wallet_uses (
  tenant_id   uuid          NOT NULL REFERENCES erp.tenants (id),
  id          uuid          NOT NULL,
  pos_sale_id uuid          NOT NULL,
  kind        text          NOT NULL,
  amount      numeric(18,4) NOT NULL,
  points      numeric(18,2),
  reference   text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, pos_sale_id) REFERENCES erp.pos_sales (tenant_id, id),
  CONSTRAINT pos_wallet_uses_kind_valid CHECK (kind IN ('store_credit_used', 'store_credit_issued', 'points_redeemed', 'points_earned', 'coupon')),
  CONSTRAINT pos_wallet_uses_amount_valid CHECK (amount >= 0)
);
CREATE TRIGGER pos_wallet_uses_immutable BEFORE UPDATE OR DELETE ON erp.pos_wallet_uses FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['retail_settings', 'loyalty_ledger', 'coupons', 'coupon_redemptions', 'pos_wallet_uses'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.retail_settings, erp.coupons TO erp_app;
GRANT SELECT, INSERT ON erp.loyalty_ledger, erp.coupon_redemptions, erp.pos_wallet_uses TO erp_app;
