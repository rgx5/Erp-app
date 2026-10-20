#!/usr/bin/env bash
# Starts (idempotently) a throwaway PostgreSQL 16 on port ${PGPORT:-5433}, data in ${PGDATA_DIR:-/tmp/pgdata16}.
# Needs the server binaries (Debian/Ubuntu: apt install postgresql-16) and root or the `postgres` user.
set -euo pipefail
PGB="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT:-5433}"
DIR="${PGDATA_DIR:-/tmp/pgdata16}"

as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

if [ ! -f "$DIR/PG_VERSION" ]; then
  mkdir -p "$DIR"
  if [ "$(id -u)" = "0" ]; then chown postgres:postgres "$DIR"; fi
  chmod 700 "$DIR"
  as_pg "$PGB/initdb" -D "$DIR" -A trust -U postgres >/dev/null
fi
if ! "$PGB/pg_isready" -q -h localhost -p "$PORT"; then
  as_pg "$PGB/pg_ctl" -D "$DIR" -o "-p $PORT -k /tmp" -l /tmp/kosh-pg.log -w start >/dev/null
fi
echo "postgres ready on :$PORT"
