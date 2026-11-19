-- Approved remote support. Staff request a time-limited session; the site shows its customer a code; the customer reads it out; staff enter it;
-- only then does the site's agent open access, and it closes again by itself at the end. Nothing is ever open without the customer's say-so.
CREATE TABLE support_sessions (
  id           uuid PRIMARY KEY,
  site_id      uuid        NOT NULL REFERENCES sites (id),
  requested_by uuid        NOT NULL REFERENCES staff_users (id),
  reason       text        NOT NULL,
  minutes      integer     NOT NULL,
  public_key   text        NOT NULL,
  status       text        NOT NULL DEFAULT 'requested',
  entered_code text,
  opened_at    timestamptz,
  expires_at   timestamptz,
  closed_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_status_valid CHECK (status IN ('requested', 'awaiting_code', 'open', 'closed', 'refused', 'cancelled')),
  CONSTRAINT support_minutes_valid CHECK (minutes BETWEEN 5 AND 120)
);
CREATE UNIQUE INDEX support_one_active ON support_sessions (site_id) WHERE status IN ('requested', 'awaiting_code', 'open');
