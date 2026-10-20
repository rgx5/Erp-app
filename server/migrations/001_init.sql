-- Kosh Server: tenants, people, devices, documents.
-- Every table that holds business data carries org_id; every query filters by it.

CREATE TABLE orgs (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  industry    TEXT NOT NULL DEFAULT 'general',
  plan        TEXT NOT NULL DEFAULT 'free',
  profile     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The per-org revision counter. Every document write takes the next value under this row's lock, so revisions commit in order
  -- and a device pulling "everything after revision N" can never miss a document.
  rev         BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  code        TEXT,
  address     TEXT NOT NULL DEFAULT '',
  phone       TEXT NOT NULL DEFAULT '',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX branches_org ON branches (org_id);

CREATE TABLE roles (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE users (
  id                TEXT NOT NULL,
  org_id            TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  email             TEXT,
  password_hash     TEXT,
  pin_hash          TEXT,
  -- One of the three built-in roles (what a client falls back to) …
  role              TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
  -- … and, optionally, a custom role whose permissions apply instead.
  role_id           TEXT REFERENCES roles(id) ON DELETE SET NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  code              TEXT,
  branches          TEXT[],                   -- NULL = every branch
  token_ver         INTEGER NOT NULL DEFAULT 0,
  pin_fail          INTEGER NOT NULL DEFAULT 0,
  pin_locked_until  BIGINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A user id is only unique within its organisation (a client may choose its own ids, e.g. when moving a business off a phone).
  PRIMARY KEY (org_id, id)
);
CREATE UNIQUE INDEX users_email ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_code ON users (org_id, code) WHERE code IS NOT NULL;
CREATE INDEX users_org ON users (org_id);

CREATE TABLE devices (
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  user_id      TEXT,
  name         TEXT NOT NULL DEFAULT '',
  platform     TEXT NOT NULL DEFAULT '',
  push_token   TEXT,
  revoked      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Bumped by "sign out": every token issued before it stops working.
  session_ver  INTEGER NOT NULL DEFAULT 0,
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, id)
);

-- The replicated documents. `data` is NULL for a deleted record (a tombstone, so other devices learn of the delete).
CREATE TABLE docs (
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  coll        TEXT NOT NULL,
  id          TEXT NOT NULL,
  branch_id   TEXT,
  data        JSONB,
  rev         BIGINT NOT NULL,
  deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (org_id, coll, id)
);
CREATE INDEX docs_rev ON docs (org_id, rev);

-- Idempotency: a mutation id seen before changes nothing.
CREATE TABLE mutations (
  org_id  TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  mid     TEXT NOT NULL,
  rev     BIGINT NOT NULL DEFAULT 0,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, mid)
);

CREATE TABLE files (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT '',
  content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
  size          BIGINT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX files_org ON files (org_id);

CREATE TABLE share_tokens (
  token       TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  coll        TEXT NOT NULL,
  doc_id      TEXT NOT NULL,
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ
);
CREATE INDEX share_org ON share_tokens (org_id);

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  secret_hash  TEXT NOT NULL,
  permissions  TEXT[] NOT NULL DEFAULT '{}',
  created_by   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used    TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX api_keys_org ON api_keys (org_id);

-- Password-login throttling (per email + client address), escalating like the app's own PIN lockout.
CREATE TABLE login_throttle (
  key           TEXT PRIMARY KEY,
  fails         INTEGER NOT NULL DEFAULT 0,
  locked_until  BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
