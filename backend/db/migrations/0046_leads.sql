-- Leads: enquiries from adverts, the website and people, followed through a pipeline to a customer and a sale.
CREATE TABLE erp.lead_settings (
  tenant_id        uuid        PRIMARY KEY REFERENCES erp.tenants (id),
  assignment_mode  text        NOT NULL DEFAULT 'manual',
  members          uuid[]      NOT NULL DEFAULT '{}',
  rules            jsonb       NOT NULL DEFAULT '[]',
  sla_minutes      integer     NOT NULL DEFAULT 30,
  rr_cursor        integer     NOT NULL DEFAULT 0,
  lead_seq         bigint      NOT NULL DEFAULT 0,
  lost_reasons     text[]      NOT NULL DEFAULT ARRAY['Price too high','Chose a competitor','Not interested','Not reachable','Not eligible','Bought elsewhere','Duplicate','Other'],
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_settings_mode CHECK (assignment_mode IN ('manual', 'round_robin')),
  CONSTRAINT lead_settings_sla CHECK (sla_minutes BETWEEN 1 AND 10080)
);

CREATE TABLE erp.lead_stages (
  tenant_id  uuid    NOT NULL REFERENCES erp.tenants (id),
  id         uuid    NOT NULL,
  name       text    NOT NULL,
  position   integer NOT NULL,
  kind       text    NOT NULL DEFAULT 'open',
  status     text    NOT NULL DEFAULT 'active',
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT lead_stage_kind CHECK (kind IN ('open', 'won', 'lost')),
  CONSTRAINT lead_stage_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT lead_stage_name CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX lead_stage_name_unique ON erp.lead_stages (tenant_id, lower(name)) WHERE status = 'active';

CREATE TABLE erp.lead_connectors (
  tenant_id      uuid        NOT NULL REFERENCES erp.tenants (id),
  id             uuid        NOT NULL,
  kind           text        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  public_id      text        NOT NULL,
  config         jsonb       NOT NULL DEFAULT '{}',
  secret_sealed  text,
  lead_count     integer     NOT NULL DEFAULT 0,
  last_lead_at   timestamptz,
  last_error     text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT lead_connector_kind CHECK (kind IN ('website', 'meta', 'google', 'webhook')),
  CONSTRAINT lead_connector_status CHECK (status IN ('active', 'paused'))
);
CREATE UNIQUE INDEX lead_connector_public ON erp.lead_connectors (public_id);

-- What the public intake looks up without a signed-in person: which business and connector an address belongs to. Inside a business only its own rows
-- are visible; with no business chosen (the intake's first step) the rows can be read, and they say nothing but that pointer.
CREATE TABLE erp.lead_ingest_keys (
  tenant_id     uuid NOT NULL REFERENCES erp.tenants (id),
  public_id     text NOT NULL,
  connector_id  uuid NOT NULL,
  PRIMARY KEY (tenant_id, public_id)
);
CREATE UNIQUE INDEX lead_ingest_public ON erp.lead_ingest_keys (public_id);

CREATE TABLE erp.leads (
  tenant_id           uuid          NOT NULL REFERENCES erp.tenants (id),
  id                  uuid          NOT NULL,
  lead_no             text          NOT NULL,
  name                text          NOT NULL,
  phone               text,
  phone_norm          text,
  email               text,
  city                text,
  pincode             text,
  state               text,
  source              text          NOT NULL DEFAULT 'manual',
  connector_id        uuid,
  external_id         text,
  campaign            text,
  adset               text,
  ad                  text,
  form_name           text,
  utm                 jsonb         NOT NULL DEFAULT '{}',
  click_id            text,
  stage_id            uuid          NOT NULL,
  status              text          NOT NULL DEFAULT 'open',
  lost_reason         text,
  owner_id            uuid,
  assigned_at         timestamptz,
  first_response_at   timestamptz,
  sla_due_at          timestamptz,
  next_follow_up_at   timestamptz,
  interest            text,
  value_estimate      numeric(18,2),
  fields              jsonb         NOT NULL DEFAULT '{}',
  consent             boolean       NOT NULL DEFAULT false,
  consent_at          timestamptz,
  enquiry_count       integer       NOT NULL DEFAULT 1,
  party_id            uuid,
  converted_at        timestamptz,
  duplicate_of        uuid,
  raw                 jsonb,
  created_by          uuid,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, stage_id) REFERENCES erp.lead_stages (tenant_id, id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES erp.parties (tenant_id, id),
  CONSTRAINT lead_status_valid CHECK (status IN ('open', 'won', 'lost')),
  CONSTRAINT lead_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT lead_source_valid CHECK (source IN ('website', 'meta', 'google', 'webhook', 'manual', 'import', 'indiamart', 'justdial', 'referral', 'walkin', 'phone', 'whatsapp', 'other'))
);
CREATE UNIQUE INDEX lead_no_unique ON erp.leads (tenant_id, lead_no);
CREATE UNIQUE INDEX lead_external_unique ON erp.leads (tenant_id, connector_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX lead_status_created ON erp.leads (tenant_id, status, created_at DESC);
CREATE INDEX lead_owner ON erp.leads (tenant_id, owner_id) WHERE status = 'open';
CREATE INDEX lead_phone ON erp.leads (tenant_id, phone_norm) WHERE phone_norm IS NOT NULL;
CREATE INDEX lead_email ON erp.leads (tenant_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX lead_party ON erp.leads (tenant_id, party_id) WHERE party_id IS NOT NULL;

CREATE TABLE erp.lead_activities (
  tenant_id   uuid        NOT NULL REFERENCES erp.tenants (id),
  id          uuid        NOT NULL,
  lead_id     uuid        NOT NULL,
  kind        text        NOT NULL,
  body        text        NOT NULL DEFAULT '',
  due_at      timestamptz,
  done_at     timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES erp.leads (tenant_id, id),
  CONSTRAINT lead_activity_kind CHECK (kind IN ('note', 'call', 'whatsapp', 'email', 'visit', 'survey', 'task', 'stage', 'assign', 'system'))
);
CREATE INDEX lead_activity_lead ON erp.lead_activities (tenant_id, lead_id, created_at DESC);
CREATE INDEX lead_activity_due ON erp.lead_activities (tenant_id, due_at) WHERE kind = 'task' AND done_at IS NULL;

CREATE TABLE erp.lead_ad_spend (
  tenant_id    uuid          NOT NULL REFERENCES erp.tenants (id),
  id           uuid          NOT NULL,
  spend_date   date          NOT NULL,
  source       text          NOT NULL,
  campaign     text          NOT NULL DEFAULT '',
  amount       numeric(18,2) NOT NULL,
  impressions  integer,
  clicks       integer,
  note         text,
  created_by   uuid,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT lead_spend_amount CHECK (amount >= 0)
);
CREATE UNIQUE INDEX lead_spend_unique ON erp.lead_ad_spend (tenant_id, spend_date, source, campaign);

CREATE TABLE erp.lead_deliveries (
  tenant_id     uuid        NOT NULL REFERENCES erp.tenants (id),
  id            uuid        NOT NULL,
  connector_id  uuid        NOT NULL,
  outcome       text        NOT NULL,
  detail        text,
  external_id   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT lead_delivery_outcome CHECK (outcome IN ('created', 'duplicate', 'rejected', 'error', 'test'))
);
CREATE INDEX lead_delivery_connector ON erp.lead_deliveries (tenant_id, connector_id, created_at DESC);

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['lead_stages', 'lead_connectors', 'leads', 'lead_activities', 'lead_ad_spend', 'lead_deliveries', 'lead_ingest_keys'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
  ALTER TABLE erp.lead_settings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE erp.lead_settings FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON erp.lead_settings TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id());
END
$rls$;
GRANT SELECT, INSERT, UPDATE ON erp.lead_settings, erp.lead_stages, erp.lead_connectors, erp.leads, erp.lead_activities, erp.lead_ad_spend, erp.lead_deliveries TO erp_app;
GRANT DELETE ON erp.lead_ad_spend, erp.lead_deliveries, erp.lead_stages TO erp_app;
CREATE POLICY lookup ON erp.lead_ingest_keys FOR SELECT TO erp_app USING (erp.current_tenant_id() IS NULL);
GRANT SELECT, INSERT, DELETE ON erp.lead_ingest_keys TO erp_app;
