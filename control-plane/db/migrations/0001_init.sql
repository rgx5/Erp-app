-- The control plane's own database. It holds no client business data: only who the clients and sites are, what each has licensed,
-- which releases exist, what each site last reported, and a record of what staff did.

CREATE TABLE staff_users (
  id            uuid PRIMARY KEY,
  email         text        NOT NULL,
  display_name  text        NOT NULL,
  password_hash text        NOT NULL,
  role          text        NOT NULL,
  status        text        NOT NULL DEFAULT 'active',
  failed_logins integer     NOT NULL DEFAULT 0,
  locked_until  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_role_valid CHECK (role IN ('admin', 'support', 'viewer')),
  CONSTRAINT staff_status_valid CHECK (status IN ('active', 'disabled'))
);
CREATE UNIQUE INDEX staff_email_unique ON staff_users (lower(email));

CREATE TABLE staff_sessions (
  token_hash bytea PRIMARY KEY,
  staff_id   uuid        NOT NULL REFERENCES staff_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE clients (
  id         uuid PRIMARY KEY,
  name       text        NOT NULL,
  tier       text        NOT NULL,
  status     text        NOT NULL DEFAULT 'active',
  contact    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clients_tier_valid CHECK (tier IN ('local', 'hybrid', 'hybrid_plus', 'cloud')),
  CONSTRAINT clients_status_valid CHECK (status IN ('active', 'suspended', 'cancelled'))
);

CREATE TABLE sites (
  id                 uuid PRIMARY KEY,
  client_id          uuid        NOT NULL REFERENCES clients (id),
  code               text        NOT NULL,
  name               text        NOT NULL,
  kind               text        NOT NULL DEFAULT 'onprem',
  status             text        NOT NULL DEFAULT 'planned',
  tenant_id          uuid,
  ring               smallint    NOT NULL DEFAULT 2,
  updates_paused     boolean     NOT NULL DEFAULT false,
  maintenance_window jsonb       NOT NULL DEFAULT '{"days":[0],"startHour":2,"durationHours":3,"timezone":"Asia/Kolkata"}'::jsonb,
  agent_token_hash   bytea,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sites_kind_valid CHECK (kind IN ('onprem', 'dedicated', 'pooled')),
  CONSTRAINT sites_status_valid CHECK (status IN ('planned', 'installed', 'active', 'suspended', 'retired')),
  CONSTRAINT sites_ring_valid CHECK (ring BETWEEN 0 AND 2),
  CONSTRAINT sites_code_format CHECK (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$')
);
CREATE UNIQUE INDEX sites_code_unique ON sites (lower(code));

-- What a site last reported. One row per site, replaced by each heartbeat; the history is in heartbeats.
CREATE TABLE site_status (
  site_id              uuid PRIMARY KEY REFERENCES sites (id),
  last_seen_at         timestamptz NOT NULL,
  version              text,
  payload              jsonb       NOT NULL
);
CREATE TABLE heartbeats (
  id          bigserial PRIMARY KEY,
  site_id     uuid        NOT NULL REFERENCES sites (id),
  received_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb       NOT NULL
);
CREATE INDEX heartbeats_site_time ON heartbeats (site_id, received_at DESC);

CREATE TABLE licences (
  id          uuid PRIMARY KEY,
  site_id     uuid        NOT NULL REFERENCES sites (id),
  licence_id  text        NOT NULL UNIQUE,
  licence     jsonb       NOT NULL,
  signature   text        NOT NULL,
  issued_by   uuid        NOT NULL REFERENCES staff_users (id),
  issued_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_reason text
);
CREATE INDEX licences_site ON licences (site_id, issued_at DESC);

CREATE TABLE releases (
  id            uuid PRIMARY KEY,
  version       text        NOT NULL UNIQUE,
  manifest      jsonb       NOT NULL,
  signature     text        NOT NULL,
  status        text        NOT NULL DEFAULT 'draft',
  open_ring     smallint,
  created_by    uuid        NOT NULL REFERENCES staff_users (id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT releases_status_valid CHECK (status IN ('draft', 'rolling', 'withdrawn')),
  CONSTRAINT releases_ring_valid CHECK (open_ring IS NULL OR open_ring BETWEEN 0 AND 2),
  CONSTRAINT releases_version_format CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

CREATE TABLE staff_audit (
  id         bigserial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  staff_id   uuid REFERENCES staff_users (id),
  action     text        NOT NULL,
  entity     text,
  entity_id  text,
  details    jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX staff_audit_time ON staff_audit (at DESC);
