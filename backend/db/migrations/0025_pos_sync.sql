-- POS offline sync: registered tills (devices) and the ledger of what each one has uploaded. A till queues its sales and returns
-- while offline, each with a client-generated id; the server applies each item atomically exactly once, and remembers the outcome
-- (applied or rejected with a reason) so a retried upload never books a sale twice.

CREATE TABLE erp.pos_devices (
  tenant_id      uuid        NOT NULL,
  id             uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  terminal_id    uuid        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  last_sync_at   timestamptz,
  registered_by  uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, terminal_id) REFERENCES erp.pos_terminals (tenant_id, id),
  FOREIGN KEY (tenant_id, registered_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT pos_devices_name_unique UNIQUE (tenant_id, terminal_id, name),
  CONSTRAINT pos_devices_status_valid CHECK (status IN ('active', 'revoked'))
);

CREATE TABLE erp.pos_sync_items (
  tenant_id      uuid        NOT NULL,
  device_id      uuid        NOT NULL,
  client_id      uuid        NOT NULL,
  kind           text        NOT NULL,
  payload_hash   text        NOT NULL,
  occurred_at    text        NOT NULL,
  status         text        NOT NULL,
  pos_sale_id    uuid,
  error_code     text,
  error_message  text,
  attempts       integer     NOT NULL DEFAULT 1,
  received_at    timestamptz NOT NULL DEFAULT now(),
  processed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, device_id, client_id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES erp.pos_devices (tenant_id, id),
  FOREIGN KEY (tenant_id, pos_sale_id) REFERENCES erp.pos_sales (tenant_id, id),
  CONSTRAINT pos_sync_items_kind_valid CHECK (kind IN ('sale', 'return')),
  CONSTRAINT pos_sync_items_status_valid CHECK (status IN ('applied', 'rejected')),
  CONSTRAINT pos_sync_items_outcome_consistent CHECK ((status = 'applied') = (pos_sale_id IS NOT NULL) AND (status = 'rejected') = (error_code IS NOT NULL))
);
CREATE INDEX pos_sync_items_rejected_idx ON erp.pos_sync_items (tenant_id, device_id) WHERE status = 'rejected';

-- An applied item is final. A rejected one may be retried (same client id, same content), or its device revoked.
CREATE FUNCTION erp.guard_pos_sync_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'applied' OR NEW.payload_hash <> OLD.payload_hash OR NEW.kind <> OLD.kind OR NEW.occurred_at <> OLD.occurred_at THEN
    RAISE EXCEPTION 'an uploaded till item is final once applied, and its content never changes' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_sync_items_guard BEFORE UPDATE OR DELETE ON erp.pos_sync_items FOR EACH ROW EXECUTE FUNCTION erp.guard_pos_sync_item();
CREATE FUNCTION erp.guard_pos_device() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'status' - 'last_sync_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'last_sync_at') OR (OLD.status = 'revoked' AND NEW.status <> 'revoked') THEN
    RAISE EXCEPTION 'a till device only changes its status (revoked is final) and last sync time' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_devices_guard BEFORE UPDATE OR DELETE ON erp.pos_devices FOR EACH ROW EXECUTE FUNCTION erp.guard_pos_device();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pos_devices', 'pos_sync_items'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.pos_devices, erp.pos_sync_items TO erp_app;
GRANT UPDATE (status, last_sync_at) ON erp.pos_devices TO erp_app;
GRANT UPDATE (status, pos_sale_id, error_code, error_message, attempts, processed_at) ON erp.pos_sync_items TO erp_app;
