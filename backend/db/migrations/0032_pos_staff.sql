-- Counter staff: a PIN per user (to approve a discount at the till), the salesperson credited on each sale line, and who approved a sale.
ALTER TABLE erp.retail_settings
  ADD COLUMN max_discount_without_approval numeric(7,4),
  ADD CONSTRAINT retail_settings_max_discount_valid CHECK (max_discount_without_approval IS NULL OR (max_discount_without_approval >= 0 AND max_discount_without_approval <= 100));

CREATE TABLE erp.pos_staff_pins (
  tenant_id       uuid        NOT NULL REFERENCES erp.tenants (id),
  user_id         uuid        NOT NULL,
  pin_hash        text        NOT NULL,
  failed_attempts integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES erp.users (tenant_id, id)
);

CREATE TABLE erp.pos_sale_staff (
  tenant_id      uuid    NOT NULL REFERENCES erp.tenants (id),
  pos_sale_id    uuid    NOT NULL,
  line_no        integer NOT NULL,
  salesperson_id uuid    NOT NULL,
  PRIMARY KEY (tenant_id, pos_sale_id, line_no),
  FOREIGN KEY (tenant_id, pos_sale_id) REFERENCES erp.pos_sales (tenant_id, id),
  FOREIGN KEY (tenant_id, salesperson_id) REFERENCES erp.users (tenant_id, id)
);
CREATE TRIGGER pos_sale_staff_immutable BEFORE UPDATE OR DELETE ON erp.pos_sale_staff FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

CREATE TABLE erp.pos_sale_approvals (
  tenant_id       uuid          NOT NULL REFERENCES erp.tenants (id),
  pos_sale_id     uuid          NOT NULL,
  approved_by     uuid          NOT NULL,
  highest_discount numeric(7,4) NOT NULL,
  PRIMARY KEY (tenant_id, pos_sale_id),
  FOREIGN KEY (tenant_id, pos_sale_id) REFERENCES erp.pos_sales (tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES erp.users (tenant_id, id)
);
CREATE TRIGGER pos_sale_approvals_immutable BEFORE UPDATE OR DELETE ON erp.pos_sale_approvals FOR EACH ROW EXECUTE FUNCTION erp.reject_ledger_change();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_staff_pins', 'pos_sale_staff', 'pos_sale_approvals'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.pos_staff_pins TO erp_app;
GRANT SELECT, INSERT ON erp.pos_sale_staff, erp.pos_sale_approvals TO erp_app;
