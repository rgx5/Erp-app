-- Per-site rules for remote users: what they may do, from where, and when. Empty means "no extra limits".
ALTER TABLE sites ADD COLUMN remote_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
