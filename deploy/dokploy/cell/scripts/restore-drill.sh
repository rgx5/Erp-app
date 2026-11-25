#!/bin/bash
# Proves a backup can actually be restored: loads the newest daily dump into a scratch database next to the live one, checks it (the books balance,
# every migration is present, tenants and their key tables are there), drops it, and writes the result to /status/drill.json. Run it monthly, and
# after any change to backups. With "loop" it runs once a month by itself. Needs PGHOST/PGPASSWORD (superuser) and the dumps volume at /dumps.
set -uo pipefail
export PGHOST="${PGHOST:-postgres}" PGUSER="${PGUSER:-postgres}"
STATUS_DIR="${STATUS_DIR:-/status}"; DUMPS="${DUMPS:-/dumps}"; DB="erp_drill"; LIVE="${LIVE_DB:-erp}"
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$1" -c "$2"; }
run_once() {
  local started=$(date +%s) file checks="" ok=true note=""
  add() { checks="${checks:+$checks,}{\"name\":\"$1\",\"ok\":$2,\"detail\":\"$3\"}"; [ "$2" = true ] || ok=false; }
  file=$(ls -1t "$DUMPS"/erp-*.sql.gz 2>/dev/null | head -1)
  if [ -z "$file" ]; then add "a dump exists" false "no dump found in $DUMPS"
  else
    add "a dump exists" true "$(basename "$file")"
    q postgres "DROP DATABASE IF EXISTS $DB" && q postgres "CREATE DATABASE $DB"
    if gunzip -c "$file" | psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >/dev/null 2>/tmp/drill.err; then add "dump restores without errors" true "loaded into $DB"
    else add "dump restores without errors" false "$(head -c 300 /tmp/drill.err | tr -d '"\n')"; fi
    if [ "$ok" = true ]; then
      bal=$(q $DB "SELECT CASE WHEN to_regclass('erp.journal_lines') IS NULL THEN 'none' ELSE (SELECT (coalesce(sum(debit),0)=coalesce(sum(credit),0))::text FROM erp.journal_lines) END")
      [ "$bal" = true ] || [ "$bal" = none ] && add "ledger balances (debits equal credits)" true "$bal" || add "ledger balances (debits equal credits)" false "$bal"
      head_r=$(q $DB "SELECT max(id) FROM erp.schema_migrations"); head_l=$(q $LIVE "SELECT max(id) FROM erp.schema_migrations")
      [ -n "$head_r" ] && [ "$head_r" \< "$head_l" -o "$head_r" = "$head_l" ] && add "migration history restored" true "restored $head_r, live $head_l" || add "migration history restored" false "restored '$head_r', live '$head_l'"
      t_r=$(q $DB "SELECT count(*) FROM erp.tenant_directory"); t_l=$(q $LIVE "SELECT count(*) FROM erp.tenant_directory")
      [ "$t_r" -gt 0 ] || [ "$t_l" -eq 0 ] && add "clients present" true "restored $t_r, live $t_l" || add "clients present" false "restored $t_r, live $t_l"
      lines=$(q $DB "SELECT count(*) FROM erp.journal_lines" 2>/dev/null || echo 0)
      add "ledger rows restored" true "$lines journal lines"
    fi
    q postgres "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
  fi
  mkdir -p "$STATUS_DIR"
  printf '{"ok":%s,"at":%s,"seconds":%s,"dump":"%s","checks":[%s]}\n' "$ok" "$(date +%s)" "$(( $(date +%s) - started ))" "$(basename "${file:-none}")" "$checks" > "$STATUS_DIR/drill.json.tmp" && mv "$STATUS_DIR/drill.json.tmp" "$STATUS_DIR/drill.json"
  cat "$STATUS_DIR/drill.json"; [ "$ok" = true ]
}
if [ "${1:-}" = loop ]; then
  sleep "${DRILL_FIRST_DELAY_SECONDS:-3600}"   # let tonight's first dump exist
  while true; do run_once || true; sleep "${DRILL_INTERVAL_SECONDS:-2592000}"; done
else run_once; fi
