#!/bin/bash
# Starts PostgreSQL for a cell. When BACKUP_S3_BUCKET is set, the database also ships every finished write-ahead-log segment (and forces one at least
# every ARCHIVE_TIMEOUT seconds) to an encrypted pgBackRest repository in S3-compatible storage, which is what makes point-in-time recovery possible.
# Without it the database starts as before (daily dumps only) and the platform shows backups as "not configured".
set -euo pipefail
args=(postgres)
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  : "${BACKUP_S3_ENDPOINT:?set BACKUP_S3_ENDPOINT}" "${BACKUP_S3_KEY:?set BACKUP_S3_KEY}" "${BACKUP_S3_SECRET:?set BACKUP_S3_SECRET}" "${BACKUP_CIPHER_PASS:?set BACKUP_CIPHER_PASS}"
  /usr/local/bin/pgbackrest-conf.sh
  args+=(-c wal_level=replica -c archive_mode=on -c "archive_timeout=${ARCHIVE_TIMEOUT:-60}" -c max_wal_senders=4
         -c "archive_command=pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=cell archive-push %p")
fi
exec docker-entrypoint.sh "${args[@]}"
