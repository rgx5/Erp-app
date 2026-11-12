#!/usr/bin/env bash
# Runs once when the Postgres container first starts: creates the two roles and the erp schema (db/bootstrap/bootstrap.sql).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_password="${MIGRATOR_PASSWORD}" -v app_password="${APP_PASSWORD}" \
  -f /bootstrap/bootstrap.sql
