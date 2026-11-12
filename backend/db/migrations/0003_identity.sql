-- Identity: users, roles, sessions (rotating refresh tokens), API keys, MFA recovery codes, and the tenant directory.
-- Same rules as 0002: (tenant_id, id) keys, composite tenant-aware foreign keys, FORCED row-level security, no DELETE grants
-- (assignments and credentials are revoked with a timestamp, never removed).

-- ---------------------------------------------------------------------------------------------------------------------
-- Tenant directory. Signing in starts from a tenant *slug*, but erp.tenants is protected by RLS and cannot be read until a
-- tenant is known. This one narrow mapping (slug -> id) is therefore NOT tenant-scoped. It holds nothing else, is filled
-- only by a trigger, and the runtime role can read it but cannot write it.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.tenant_directory (
  slug       text PRIMARY KEY,
  tenant_id  uuid NOT NULL UNIQUE
);

CREATE FUNCTION erp.sync_tenant_directory() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, erp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO erp.tenant_directory (slug, tenant_id) VALUES (NEW.slug, NEW.id);
  ELSIF NEW.slug IS DISTINCT FROM OLD.slug THEN
    UPDATE erp.tenant_directory SET slug = NEW.slug WHERE tenant_id = NEW.id;
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION erp.sync_tenant_directory() FROM PUBLIC;
CREATE TRIGGER tenants_directory AFTER INSERT OR UPDATE OF slug ON erp.tenants
  FOR EACH ROW EXECUTE FUNCTION erp.sync_tenant_directory();
INSERT INTO erp.tenant_directory (slug, tenant_id) SELECT slug, id FROM erp.tenants;
GRANT SELECT ON erp.tenant_directory TO erp_app;

-- ---------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp.users (
  tenant_id           uuid        NOT NULL REFERENCES erp.tenants (id),
  id                  uuid        NOT NULL,
  email               text        NOT NULL,
  display_name        text        NOT NULL,
  password_hash       text        NOT NULL,
  status              text        NOT NULL DEFAULT 'active',
  mfa_enabled         boolean     NOT NULL DEFAULT false,
  mfa_secret_enc      text,
  mfa_last_step       bigint,
  failed_login_count  integer     NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  version             integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT users_email_unique UNIQUE (tenant_id, email),
  CONSTRAINT users_email_format CHECK (email = lower(email) AND length(email) <= 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
  CONSTRAINT users_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT users_status_valid CHECK (status IN ('active', 'disabled')),
  CONSTRAINT users_mfa_secret_present CHECK (NOT mfa_enabled OR mfa_secret_enc IS NOT NULL)
);

CREATE TABLE erp.roles (
  tenant_id    uuid        NOT NULL REFERENCES erp.tenants (id),
  id           uuid        NOT NULL,
  name         text        NOT NULL,
  description  text,
  is_system    boolean     NOT NULL DEFAULT false,
  permissions  text[]      NOT NULL DEFAULT '{}',
  version      integer     NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CONSTRAINT roles_name_not_blank CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX roles_name_unique ON erp.roles (tenant_id, lower(name));

CREATE TABLE erp.user_roles (
  tenant_id   uuid        NOT NULL,
  user_id     uuid        NOT NULL,
  role_id     uuid        NOT NULL,
  granted_by  uuid,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  PRIMARY KEY (tenant_id, user_id, role_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES erp.users (tenant_id, id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES erp.roles (tenant_id, id),
  FOREIGN KEY (tenant_id, granted_by) REFERENCES erp.users (tenant_id, id)
);
CREATE INDEX user_roles_role_idx ON erp.user_roles (tenant_id, role_id);

-- One row per refresh token. Tokens rotate: using one marks it used_at and issues a new row in the same family.
-- Presenting a token that was already used means it leaked, so the whole family is revoked (reuse detection).
CREATE TABLE erp.sessions (
  tenant_id        uuid        NOT NULL,
  id               uuid        NOT NULL,
  family_id        uuid        NOT NULL,
  user_id          uuid        NOT NULL,
  token_hash       bytea       NOT NULL,
  expires_at       timestamptz NOT NULL,
  used_at          timestamptz,
  revoked_at       timestamptz,
  revoked_reason   text,
  user_agent       text,
  ip_address       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT sessions_token_unique UNIQUE (tenant_id, token_hash)
);
CREATE INDEX sessions_family_idx ON erp.sessions (tenant_id, family_id);
CREATE INDEX sessions_user_idx ON erp.sessions (tenant_id, user_id);

CREATE TABLE erp.api_keys (
  tenant_id     uuid        NOT NULL,
  id            uuid        NOT NULL,
  name          text        NOT NULL,
  key_prefix    text        NOT NULL,
  secret_hash   bytea       NOT NULL,
  permissions   text[]      NOT NULL DEFAULT '{}',
  created_by    uuid        NOT NULL,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  version       integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, created_by) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT api_keys_name_not_blank CHECK (btrim(name) <> '')
);

CREATE TABLE erp.mfa_recovery_codes (
  tenant_id  uuid        NOT NULL,
  id         uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  code_hash  bytea       NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES erp.users (tenant_id, id),
  CONSTRAINT mfa_recovery_codes_unique UNIQUE (tenant_id, user_id, code_hash)
);

-- Sign-in bookkeeping (failure counter, lockout, last login, MFA replay step) must not bump `version`: it would make an
-- administrator's If-Match edit fail whenever the person happened to sign in. Only changes an administrator can see or make count.
CREATE FUNCTION erp.touch_user() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.mfa_enabled IS DISTINCT FROM OLD.mfa_enabled OR NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END
$$;
GRANT EXECUTE ON FUNCTION erp.touch_user() TO erp_app;
CREATE TRIGGER users_touch BEFORE UPDATE ON erp.users FOR EACH ROW EXECUTE FUNCTION erp.touch_user();
CREATE TRIGGER roles_touch BEFORE UPDATE ON erp.roles FOR EACH ROW EXECUTE FUNCTION erp.touch_row();
CREATE TRIGGER api_keys_touch BEFORE UPDATE ON erp.api_keys FOR EACH ROW EXECUTE FUNCTION erp.touch_row();

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'roles', 'user_roles', 'sessions', 'api_keys', 'mfa_recovery_codes'] LOOP
    EXECUTE format('ALTER TABLE erp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE erp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON erp.%I TO erp_app USING (tenant_id = erp.current_tenant_id()) WITH CHECK (tenant_id = erp.current_tenant_id())', t);
  END LOOP;
END
$rls$;

GRANT SELECT, INSERT, UPDATE ON erp.users, erp.roles, erp.user_roles, erp.sessions, erp.api_keys, erp.mfa_recovery_codes TO erp_app;
