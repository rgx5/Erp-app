#!/bin/bash
# Writes /etc/pgbackrest/pgbackrest.conf from the environment. The file holds the repository keys, so only the database user can read it.
set -euo pipefail
umask 077
conf=/etc/pgbackrest/pgbackrest.conf
cat > "$conf" <<CONF
[global]
compress-type=zst
compress-level=3
start-fast=y
archive-async=y
log-level-console=warn
process-max=2
repo1-type=s3
repo1-path=${BACKUP_S3_PATH:-/cell}
repo1-s3-bucket=${BACKUP_S3_BUCKET}
repo1-s3-endpoint=${BACKUP_S3_ENDPOINT}
repo1-s3-region=${BACKUP_S3_REGION:-us-east-1}
repo1-s3-uri-style=path
repo1-s3-key=${BACKUP_S3_KEY}
repo1-s3-key-secret=${BACKUP_S3_SECRET}
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=${BACKUP_CIPHER_PASS}
repo1-retention-full=${BACKUP_RETENTION_FULL:-4}
repo1-retention-diff=${BACKUP_RETENTION_DIFF:-7}

[cell]
pg1-path=/var/lib/postgresql/data
pg1-socket-path=/var/run/postgresql
pg1-user=postgres
CONF
chmod 600 "$conf"
if [ "$(id -u)" = 0 ]; then chown postgres:postgres "$conf"; fi
