-- Every tenant the control plane knows about, across all cells (sites). Reported by each cell's agent; counts and pass/fail only, never business content.
CREATE TABLE site_tenants (
  site_id      uuid        NOT NULL REFERENCES sites (id),
  tenant_id    uuid        NOT NULL,
  slug         text        NOT NULL,
  name         text        NOT NULL,
  status       text        NOT NULL,
  created_at   timestamptz,
  usage        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  licence      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  validations  jsonb,
  validated_at timestamptz,
  reported_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, tenant_id)
);
CREATE UNIQUE INDEX site_tenants_tenant ON site_tenants (tenant_id);
CREATE INDEX site_tenants_slug ON site_tenants (lower(slug));

-- A licence is for one tenant (a pooled cell hosts many).
ALTER TABLE licences ADD COLUMN tenant_id uuid;
UPDATE licences SET tenant_id = (licence ->> 'tenantId')::uuid;
ALTER TABLE licences ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX licences_tenant ON licences (tenant_id, issued_at DESC);

-- Things staff ask a cell to do. The cell's agent fetches them (outbound only), runs them against its own server, and reports the result.
CREATE TABLE site_commands (
  id           uuid PRIMARY KEY,
  site_id      uuid        NOT NULL REFERENCES sites (id),
  tenant_id    uuid        NOT NULL,
  type         text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status       text        NOT NULL DEFAULT 'pending',
  result       jsonb,
  requested_by uuid        NOT NULL REFERENCES staff_users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  CONSTRAINT site_commands_type_valid CHECK (type IN ('validate', 'suspend', 'reactivate')),
  CONSTRAINT site_commands_status_valid CHECK (status IN ('pending', 'running', 'done', 'failed'))
);
CREATE INDEX site_commands_pending ON site_commands (site_id) WHERE status IN ('pending', 'running');
