-- Platform services: audit log, idempotency keys, transactional outbox, document number series.
-- Same rules as 0002/0003. Two tables are deliberately NOT tenant-scoped (outbox_dispatch) and are explained where defined.

-- ---------------------------------------------------------------------------------------------------------------------
-- Audit log: append-only. The runtime role may INSERT and SELECT only; a trigger also rejects UPDATE/DELETE/TRUNCATE from
-- any other role. Entries are written in the SAME transaction as the change they describe, so they cannot disagree.
-- (A tamper-evident hash chain is a later, separate decision.)
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.audit_log (
  tenant_id    uuid        NOT NULL REFERENCES erp.tenants (id),
  id           uuid        NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_type   text        NOT NULL,
  actor_id     uuid,
  action       text        NOT NULL,
  entity_type  text,
  entity_id    text,
  outcome      text        NOT NULL DEFAULT 'success',
  request_id   text,
  ip_address   text,
  details      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT audit_actor_type_valid CHECK (actor_type IN ('user', 'api_key', 'system', 'anonymous')),
  CONSTRAINT audit_outcome_valid CHECK (outcome IN ('success', 'failure')),
  CONSTRAINT audit_action_format CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);
CREATE INDEX audit_log_entity_idx ON erp.audit_log (tenant_id, entity_type, entity_id, id);
CREATE INDEX audit_log_actor_idx ON erp.audit_log (tenant_id, actor_id, id);
CREATE INDEX audit_log_action_idx ON erp.audit_log (tenant_id, action, id);

CREATE FUNCTION erp.reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON erp.audit_log FOR EACH ROW EXECUTE FUNCTION erp.reject_change();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON erp.audit_log FOR EACH STATEMENT EXECUTE FUNCTION erp.reject_change();

-- ---------------------------------------------------------------------------------------------------------------------
-- Idempotency keys. The claim, the business work and the stored response commit in ONE transaction, so there is no
-- "in progress" state to get stuck in: a concurrent duplicate waits on the unique key, then replays the stored response.
-- A request that fails rolls back the claim too, so it can simply be retried. Rows expire; an expired key may be reused.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.idempotency_keys (
  tenant_id        uuid        NOT NULL REFERENCES erp.tenants (id),
  key              text        NOT NULL,
  fingerprint      bytea       NOT NULL,
  actor_id         uuid,
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, key),
  CONSTRAINT idempotency_key_format CHECK (key ~ '^[A-Za-z0-9._:-]{1,255}$')
);

-- ---------------------------------------------------------------------------------------------------------------------
-- Transactional outbox. Events are inserted in the business transaction (so they exist if and only if the change
-- committed) and delivered later, at least once, to idempotent consumers.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.outbox_events (
  tenant_id       uuid        NOT NULL REFERENCES erp.tenants (id),
  id              uuid        NOT NULL,
  event_type      text        NOT NULL,
  aggregate_type  text        NOT NULL,
  aggregate_id    text        NOT NULL,
  payload         jsonb       NOT NULL,
  request_id      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT outbox_event_type_format CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

-- Which consumer has already handled which event. Written in the SAME transaction as the consumer's own effects, so a
-- consumer's work and its "done" mark are atomic: redelivery of an event is a no-op.
CREATE TABLE erp.outbox_consumed (
  tenant_id    uuid        NOT NULL,
  event_id     uuid        NOT NULL,
  consumer     text        NOT NULL,
  consumed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id, consumer),
  FOREIGN KEY (tenant_id, event_id) REFERENCES erp.outbox_events (tenant_id, id)
);

-- The delivery queue. NOT tenant-scoped on purpose: the relay has to find due work across every tenant, and the runtime
-- role is never allowed to bypass RLS. This table is therefore a pointer list only (tenant id + event id + scheduling
-- state), with no business data; the event itself is read back inside that tenant's own context. Rows are created by a
-- trigger on outbox_events, never by application code.
CREATE TABLE erp.outbox_dispatch (
  event_id       uuid        PRIMARY KEY,
  tenant_id      uuid        NOT NULL,
  available_at   timestamptz NOT NULL DEFAULT now(),
  attempts       integer     NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  done_at        timestamptz,
  dead_at        timestamptz,
  last_error     text
);
CREATE INDEX outbox_dispatch_due_idx ON erp.outbox_dispatch (available_at) WHERE done_at IS NULL AND dead_at IS NULL;

CREATE FUNCTION erp.enqueue_outbox_dispatch() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, erp
  AS $$
BEGIN
  INSERT INTO erp.outbox_dispatch (event_id, tenant_id) VALUES (NEW.id, NEW.tenant_id);
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION erp.enqueue_outbox_dispatch() FROM PUBLIC;
CREATE TRIGGER outbox_events_enqueue AFTER INSERT ON erp.outbox_events FOR EACH ROW EXECUTE FUNCTION erp.enqueue_outbox_dispatch();
CREATE TRIGGER outbox_events_immutable BEFORE UPDATE OR DELETE ON erp.outbox_events FOR EACH ROW EXECUTE FUNCTION erp.reject_change();

-- ---------------------------------------------------------------------------------------------------------------------
-- Document number series, one per GST registration x document type x financial year (there is deliberately no single
-- global counter). Allocation takes the series row lock inside the caller's transaction, so a number is consumed if and only if
-- the document that uses it commits. Every issued number stays in number_allocations forever: a cancelled document keeps
-- its number and the number is never reissued.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.number_series (
  tenant_id                uuid        NOT NULL,
  id                       uuid        NOT NULL,
  gst_registration_id      uuid        NOT NULL,
  document_type            text        NOT NULL,
  financial_year           text        NOT NULL,
  prefix                   text        NOT NULL,
  separator                text        NOT NULL DEFAULT '/',
  include_financial_year   boolean     NOT NULL DEFAULT true,
  padding                  smallint    NOT NULL DEFAULT 5,
  next_value               bigint      NOT NULL DEFAULT 1,
  status                   text        NOT NULL DEFAULT 'active',
  version                  integer     NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, gst_registration_id) REFERENCES erp.gst_registrations (tenant_id, id),
  CONSTRAINT number_series_scope_unique UNIQUE (tenant_id, gst_registration_id, document_type, financial_year),
  CONSTRAINT number_series_doc_type_format CHECK (document_type ~ '^[a-z][a-z_]{1,39}$'),
  CONSTRAINT number_series_fy_format CHECK (financial_year ~ '^[0-9]{4}-[0-9]{2}$'),
  CONSTRAINT number_series_prefix_format CHECK (prefix ~ '^[A-Za-z0-9/-]{0,10}$'),
  CONSTRAINT number_series_separator_format CHECK (separator ~ '^[/-]?$'),
  CONSTRAINT number_series_padding_valid CHECK (padding BETWEEN 1 AND 12),
  CONSTRAINT number_series_next_positive CHECK (next_value >= 1),
  CONSTRAINT number_series_status_valid CHECK (status IN ('active', 'closed'))
);

CREATE TABLE erp.number_allocations (
  tenant_id       uuid        NOT NULL,
  id              uuid        NOT NULL,
  series_id       uuid        NOT NULL,
  value           bigint      NOT NULL,
  formatted       text        NOT NULL,
  document_ref    text,
  status          text        NOT NULL DEFAULT 'issued',
  cancel_reason   text,
  allocated_at    timestamptz NOT NULL DEFAULT now(),
  cancelled_at    timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, series_id) REFERENCES erp.number_series (tenant_id, id),
  CONSTRAINT number_allocations_value_unique UNIQUE (tenant_id, series_id, value),
  -- Statutory rule: an invoice number is at most 16 characters of letters, digits, "/" and "-". The same rule is applied to every series.
  CONSTRAINT number_allocations_format CHECK (formatted ~ '^[A-Za-z0-9/-]{1,16}$'),
  CONSTRAINT number_allocations_status_valid CHECK (status IN ('issued', 'cancelled')),
  CONSTRAINT number_allocations_cancel_consistent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
-- An allocation can change exactly once, issued -> cancelled, and only its cancellation fields. Nothing else is ever editable.
CREATE FUNCTION erp.guard_number_allocation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'number_allocations is append-only: DELETE is not allowed' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'cancelled'
     OR NEW.status <> 'cancelled'
     OR (NEW.tenant_id, NEW.id, NEW.series_id, NEW.value, NEW.formatted, NEW.document_ref, NEW.allocated_at)
        IS DISTINCT FROM (OLD.tenant_id, OLD.id, OLD.series_id, OLD.value, OLD.formatted, OLD.document_ref, OLD.allocated_at) THEN
    RAISE EXCEPTION 'number_allocations: only issued -> cancelled is allowed' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER number_allocations_guard BEFORE UPDATE OR DELETE ON erp.number_allocations FOR EACH ROW EXECUTE FUNCTION erp.guard_number_allocation();
CREATE TRIGGER number_series_touch BEFORE UPDATE ON erp.number_series FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

-- ---------------------------------------------------------------------------------------------------------------------
DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log', 'idempotency_keys', 'outbox_events', 'outbox_consumed', 'number_series', 'number_allocations'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.audit_log, erp.outbox_events, erp.outbox_consumed, erp.number_allocations TO erp_app;
GRANT UPDATE (status, cancel_reason, cancelled_at) ON erp.number_allocations TO erp_app;
GRANT SELECT, INSERT, UPDATE ON erp.idempotency_keys, erp.number_series TO erp_app;
-- The relay reads and schedules; it never creates dispatch rows (the trigger does).
GRANT SELECT, UPDATE ON erp.outbox_dispatch TO erp_app;
