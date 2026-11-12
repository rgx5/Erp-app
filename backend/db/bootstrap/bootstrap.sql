-- One-time, per-database setup run by a database ADMIN (never by the application or the migrator).
-- It creates the two roles the system uses and the schema, and nothing else:
--
--   erp_migrator  owns the schema and every table in it. Used only by the migration runner.
--   erp_app       the runtime role. NOT a superuser, NOT BYPASSRLS, owns NOTHING, cannot create objects.
--                 It receives only the table privileges that each migration grants explicitly.
--
-- Placeholders :'migrator_password' and :'app_password' are substituted by the caller (psql -v, or scripts/bootstrap-db.ts).

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_migrator') THEN
    EXECUTE format('CREATE ROLE erp_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', :'migrator_password');
  ELSE
    EXECUTE format('ALTER ROLE erp_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', :'migrator_password');
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erp_app') THEN
    EXECUTE format('CREATE ROLE erp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', :'app_password');
  ELSE
    EXECUTE format('ALTER ROLE erp_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', :'app_password');
  END IF;
END
$roles$;

DO $db$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO erp_migrator, erp_app', current_database());
END
$db$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS erp AUTHORIZATION erp_migrator;
REVOKE ALL ON SCHEMA erp FROM PUBLIC;
GRANT USAGE ON SCHEMA erp TO erp_app;

-- Needed for effective-dating exclusion constraints ("no two overlapping periods for the same thing"). Installed by the admin,
-- into the erp schema, because the public schema is closed to the application roles.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA erp;

-- Nothing is granted to erp_app by default: each migration grants exactly what its tables need.
ALTER DEFAULT PRIVILEGES FOR ROLE erp_migrator IN SCHEMA erp REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
