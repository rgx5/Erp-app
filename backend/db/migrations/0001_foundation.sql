-- Foundation: the tenant-context function every RLS policy uses, and the row-versioning trigger.

-- The tenant a transaction acts for. The application sets it with `set_config('app.tenant_id', <uuid>, true)` as the
-- FIRST statement of every transaction (transaction-local, so a pooled connection never carries it to the next request).
-- Unset or empty means "no tenant": the policies then match nothing, so forgetting to set it fails closed.
CREATE FUNCTION erp.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION erp.current_tenant_id() TO erp_app;

-- Optimistic locking: every UPDATE bumps `version` and `updated_at`. Callers include `WHERE version = <expected>`.
CREATE FUNCTION erp.touch_row() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
GRANT EXECUTE ON FUNCTION erp.touch_row() TO erp_app;

-- Migration bookkeeping is non-tenant metadata. The runtime role may read it (readiness check) but never write it.
-- (The migration runner creates erp.schema_migrations itself, before the first migration.)
