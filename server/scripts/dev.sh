#!/usr/bin/env bash
# One command for local development and live app tests: throwaway PostgreSQL + a fresh-or-existing database + migrations + the
# server on http://localhost:8090 (background; logs in /tmp/kosh-server.log). Re-running restarts only the server.
#   server/scripts/dev.sh            start (or restart) the server
#   server/scripts/dev.sh reset      drop the dev database first (an empty server)
#   server/scripts/dev.sh stop       stop the server
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8090}"
PGPORT="${PGPORT:-5433}"
DB="${KOSH_DB:-kosh_dev}"
PIDFILE=/tmp/kosh-server.pid

stop_server() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then kill "$(cat "$PIDFILE")" 2>/dev/null || true; sleep 0.5; fi
  rm -f "$PIDFILE"
}

if [ "${1:-}" = "stop" ]; then stop_server; echo "stopped"; exit 0; fi

"$HERE/scripts/pg.sh"
PSQL=(psql -h localhost -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -q)
stop_server
if [ "${1:-}" = "reset" ]; then "${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)"; fi
"${PSQL[@]}" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1 || "${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB"

cd "$HERE"
[ -d node_modules ] || npm install --silent
npm run build --silent
export DATABASE_URL="postgresql://postgres@localhost:$PGPORT/$DB"
export JWT_SECRET="${JWT_SECRET:-dev-only-secret-change-me-dev-only-secret-change-me}"
export PORT CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:8099,http://localhost:8081,http://localhost:19006}"
export FILES_DIR="${FILES_DIR:-/tmp/kosh-files}" BCRYPT_COST="${BCRYPT_COST:-8}"
nohup node dist/main.js > /tmp/kosh-server.log 2>&1 &
echo $! > "$PIDFILE"
for _ in $(seq 1 50); do
  if curl -fs "http://localhost:$PORT/health" >/dev/null 2>&1; then echo "OneSync Server on http://localhost:$PORT  (db $DB, log /tmp/kosh-server.log)"; exit 0; fi
  sleep 0.2
done
echo "server did not come up; see /tmp/kosh-server.log" >&2; tail -20 /tmp/kosh-server.log >&2; exit 1
