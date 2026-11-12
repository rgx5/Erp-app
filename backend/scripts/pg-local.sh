#!/usr/bin/env bash
# Starts (idempotently) a throwaway PostgreSQL 16 for local integration tests on ${PGPORT:-5434}.
# Needs the server binaries (Debian/Ubuntu: postgresql-16). Never used in production.
set -euo pipefail
PGB="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT:-5434}"
DIR="${PGDATA_DIR:-/tmp/erp-pgdata16}"
as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }
if [ ! -f "$DIR/PG_VERSION" ]; then
  mkdir -p "$DIR"; [ "$(id -u)" = "0" ] && chown postgres:postgres "$DIR"; chmod 700 "$DIR"
  as_pg "$PGB/initdb" -D "$DIR" -A trust -U postgres >/dev/null
fi
if ! "$PGB/pg_isready" -q -h localhost -p "$PORT"; then
  as_pg "$PGB/pg_ctl" -D "$DIR" -o "-p $PORT -k /tmp -c max_connections=200" -l /tmp/erp-pg.log -w start >/dev/null
fi
echo "postgres ready on :$PORT"
