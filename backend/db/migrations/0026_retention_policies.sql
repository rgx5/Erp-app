-- Retention: the runtime role can never delete (that is the point of the ledger design), but operational tables that only ever grow
-- (idempotency keys, delivered outbox events, expired sessions) need a purge. It is done offline by the migrator role (the table
-- owner) through `npm run maintenance:retention`. Row-level security is FORCED, so the owner needs explicit policies; they are
-- scoped to the migrator role and to exactly the tables that may be purged. Audit, accounting, stock and every document table are
-- NOT here: they are never purged.

CREATE POLICY retention_read ON erp.idempotency_keys FOR SELECT TO erp_migrator USING (true);
CREATE POLICY retention_delete ON erp.idempotency_keys FOR DELETE TO erp_migrator USING (true);
CREATE POLICY retention_read ON erp.sessions FOR SELECT TO erp_migrator USING (true);
CREATE POLICY retention_delete ON erp.sessions FOR DELETE TO erp_migrator USING (true);
CREATE POLICY retention_read ON erp.outbox_events FOR SELECT TO erp_migrator USING (true);
CREATE POLICY retention_delete ON erp.outbox_events FOR DELETE TO erp_migrator USING (true);
CREATE POLICY retention_read ON erp.outbox_consumed FOR SELECT TO erp_migrator USING (true);
CREATE POLICY retention_delete ON erp.outbox_consumed FOR DELETE TO erp_migrator USING (true);

-- Outbox events are append-only for everyone except this purge: delivered events may be deleted by the migrator role only
-- (the runtime role has no DELETE grant anyway). UPDATE stays forbidden for every role.
CREATE FUNCTION erp.guard_outbox_event() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'erp_migrator' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = '55000';
END
$$;
DROP TRIGGER outbox_events_immutable ON erp.outbox_events;
CREATE TRIGGER outbox_events_immutable BEFORE UPDATE OR DELETE ON erp.outbox_events FOR EACH ROW EXECUTE FUNCTION erp.guard_outbox_event();
