#!/usr/bin/env bash
# Runs once when the Postgres container first starts: creates the two roles and the erp schema (db/bootstrap/bootstrap.sql).
#
# bootstrap.sql carries the placeholders :'migrator_password' and :'app_password'. psql does not substitute variables inside the
# $roles$ ... $roles$ block, so they are replaced here, as properly quoted SQL literals, before the file reaches psql.
set -euo pipefail
DIR="${BOOTSTRAP_DIR:-/bootstrap}"
export MIG_Q="'$(printf '%s' "${MIGRATOR_PASSWORD:?MIGRATOR_PASSWORD is not set}" | sed "s/'/''/g")'"
export APP_Q="'$(printf '%s' "${APP_PASSWORD:?APP_PASSWORD is not set}" | sed "s/'/''/g")'"
perl -pe 's/:\x27migrator_password\x27/$ENV{MIG_Q}/g; s/:\x27app_password\x27/$ENV{APP_Q}/g' "$DIR/bootstrap.sql" \
  | psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB"
