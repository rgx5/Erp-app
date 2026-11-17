-- Approvals: a generic maker-checker engine. A policy says "for this kind of document in this company, an amount at or above the
-- threshold needs N approvals". A request carries the exact payload (by hash) to be approved; once approved it can be consumed
-- exactly once by the real command, which refuses to run without it. Requests and decisions are never deleted.

CREATE TABLE erp.approval_policies (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  company_id         uuid          NOT NULL,
  document_type      text          NOT NULL,
  threshold_amount   numeric(18,4) NOT NULL,
  required_approvals integer       NOT NULL,
  valid_days         integer       NOT NULL DEFAULT 7,
  status             text          NOT NULL DEFAULT 'active',
  version            integer       NOT NULL DEFAULT 1,
  created_by         uuid,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  updated_at         timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT approval_policies_type_valid CHECK (document_type IN ('purchase_order', 'payment', 'journal')),
  CONSTRAINT approval_policies_threshold_valid CHECK (threshold_amount >= 0),
  CONSTRAINT approval_policies_required_valid CHECK (required_approvals BETWEEN 1 AND 5),
  CONSTRAINT approval_policies_days_valid CHECK (valid_days BETWEEN 1 AND 90),
  CONSTRAINT approval_policies_status_valid CHECK (status IN ('active', 'inactive'))
);
CREATE UNIQUE INDEX approval_policies_active_unique ON erp.approval_policies (tenant_id, company_id, document_type, threshold_amount) WHERE status = 'active';

CREATE FUNCTION erp.guard_approval_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'required_approvals' - 'valid_days' - 'status' - 'version' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'required_approvals' - 'valid_days' - 'status' - 'version' - 'updated_at') THEN
    RAISE EXCEPTION 'an approval policy only changes its approvals, validity and status; it is never deleted' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_policies_guard BEFORE UPDATE OR DELETE ON erp.approval_policies FOR EACH ROW EXECUTE FUNCTION erp.guard_approval_policy();

CREATE TABLE erp.approval_requests (
  tenant_id          uuid          NOT NULL,
  id                 uuid          NOT NULL,
  company_id         uuid          NOT NULL,
  request_no         text          NOT NULL,
  document_type      text          NOT NULL,
  amount             numeric(18,4) NOT NULL,
  summary            text          NOT NULL,
  payload            jsonb         NOT NULL,
  payload_hash       text          NOT NULL,
  required_approvals integer       NOT NULL,
  valid_days         integer       NOT NULL,
  approvals_count    integer       NOT NULL DEFAULT 0,
  status             text          NOT NULL DEFAULT 'pending',
  requested_by       uuid          NOT NULL,
  requested_at       timestamptz   NOT NULL DEFAULT now(),
  decided_at         timestamptz,
  valid_until        timestamptz,
  consumed_at        timestamptz,
  consumed_by        uuid,
  consumed_ref_type  text,
  consumed_ref_id    uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES erp.companies (tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES erp.users (tenant_id, id),
  FOREIGN KEY (tenant_id, consumed_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT approval_requests_no_unique UNIQUE (tenant_id, request_no),
  CONSTRAINT approval_requests_type_valid CHECK (document_type IN ('purchase_order', 'payment', 'journal')),
  CONSTRAINT approval_requests_status_valid CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'consumed')),
  CONSTRAINT approval_requests_counts_valid CHECK (approvals_count BETWEEN 0 AND required_approvals)
);
CREATE INDEX approval_requests_inbox_idx ON erp.approval_requests (tenant_id, company_id, status, id);
CREATE INDEX approval_requests_mine_idx ON erp.approval_requests (tenant_id, requested_by, id);

-- Status moves forward only: pending -> approved | rejected | cancelled; approved -> consumed | cancelled. The content never changes.
CREATE FUNCTION erp.guard_approval_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ok boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'approval requests are never deleted' USING ERRCODE = '55000';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'approvals_count' - 'decided_at' - 'valid_until' - 'consumed_at' - 'consumed_by' - 'consumed_ref_type' - 'consumed_ref_id')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'approvals_count' - 'decided_at' - 'valid_until' - 'consumed_at' - 'consumed_by' - 'consumed_ref_type' - 'consumed_ref_id') THEN
    RAISE EXCEPTION 'the content of an approval request never changes' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = NEW.status THEN
    -- while consumed, the document it produced may be recorded once
    IF OLD.status = 'consumed' AND (OLD.consumed_ref_id IS NOT NULL OR NEW.consumed_ref_id IS NULL
        OR (OLD.consumed_at, OLD.consumed_by, OLD.approvals_count, OLD.valid_until) IS DISTINCT FROM (NEW.consumed_at, NEW.consumed_by, NEW.approvals_count, NEW.valid_until)) THEN
      RAISE EXCEPTION 'a consumed approval only records the document it produced, once' USING ERRCODE = '55000';
    END IF;
    IF OLD.status = 'pending' AND NEW.approvals_count < OLD.approvals_count THEN
      RAISE EXCEPTION 'approvals cannot be withdrawn' USING ERRCODE = '55000';
    END IF;
    IF OLD.status IN ('rejected', 'cancelled') THEN
      RAISE EXCEPTION 'a % approval request is final', OLD.status USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  v_ok := (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'cancelled'))
       OR (OLD.status = 'approved' AND NEW.status IN ('consumed', 'cancelled'));
  IF NOT v_ok THEN
    RAISE EXCEPTION 'approval request cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'approved' AND NEW.approvals_count < NEW.required_approvals THEN
    RAISE EXCEPTION 'not enough approvals yet' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_requests_guard BEFORE UPDATE OR DELETE ON erp.approval_requests FOR EACH ROW EXECUTE FUNCTION erp.guard_approval_request();

CREATE TABLE erp.approval_decisions (
  tenant_id   uuid        NOT NULL,
  id          uuid        NOT NULL,
  request_id  uuid        NOT NULL,
  decision    text        NOT NULL,
  decided_by  uuid        NOT NULL,
  comment     text,
  decided_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES erp.approval_requests (tenant_id, id),
  FOREIGN KEY (tenant_id, decided_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT approval_decisions_once UNIQUE (tenant_id, request_id, decided_by),
  CONSTRAINT approval_decisions_valid CHECK (decision IN ('approve', 'reject'))
);

-- Segregation of duties, enforced where it cannot be bypassed: nobody decides their own request, and only a pending one is decided.
CREATE FUNCTION erp.guard_approval_decision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r erp.approval_requests;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'approval decisions are append-only' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO r FROM erp.approval_requests WHERE tenant_id = NEW.tenant_id AND id = NEW.request_id;
  IF r.requested_by = NEW.decided_by THEN
    RAISE EXCEPTION 'nobody may decide their own approval request' USING ERRCODE = '55000';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'only a pending approval request can be decided' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approval_decisions_guard BEFORE INSERT OR UPDATE OR DELETE ON erp.approval_decisions FOR EACH ROW EXECUTE FUNCTION erp.guard_approval_decision();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approval_policies', 'approval_requests', 'approval_decisions'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT ON erp.approval_policies, erp.approval_requests, erp.approval_decisions TO erp_app;
GRANT UPDATE (required_approvals, valid_days, status, version, updated_at) ON erp.approval_policies TO erp_app;
GRANT UPDATE (status, approvals_count, decided_at, valid_until, consumed_at, consumed_by, consumed_ref_type, consumed_ref_id) ON erp.approval_requests TO erp_app;
