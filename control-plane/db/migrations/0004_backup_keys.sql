-- Each site's backup key, sealed to the escrow public key. The plaintext key is shown once (to the installer) and never stored here.
CREATE TABLE backup_keys (
  id         uuid PRIMARY KEY,
  site_id    uuid        NOT NULL REFERENCES sites (id),
  version    integer     NOT NULL,
  sealed     text        NOT NULL,
  created_by uuid        NOT NULL REFERENCES staff_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, version)
);
