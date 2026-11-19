-- The public address a site's remote users use (client.gateway-domain), and whether remote access is switched on for it.
ALTER TABLE sites ADD COLUMN hostname text, ADD COLUMN remote_access boolean NOT NULL DEFAULT true;
ALTER TABLE sites ADD CONSTRAINT sites_hostname_format CHECK (hostname IS NULL OR hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$');
CREATE UNIQUE INDEX sites_hostname_unique ON sites (lower(hostname)) WHERE hostname IS NOT NULL;
