ALTER TABLE staff_users
  ADD COLUMN mfa_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN mfa_secret_enc text,
  ADD COLUMN mfa_last_step bigint;

CREATE TABLE staff_recovery_codes (
  id        bigserial PRIMARY KEY,
  staff_id  uuid  NOT NULL REFERENCES staff_users (id),
  code_hash bytea NOT NULL,
  used_at   timestamptz
);
CREATE INDEX staff_recovery_codes_staff ON staff_recovery_codes (staff_id);
