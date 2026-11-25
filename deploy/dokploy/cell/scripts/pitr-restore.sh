#!/bin/bash
# Restores the cell's database from the continuous backups into a SCRATCH directory, optionally to an exact moment, and starts it on port 5499 so you can
# look at it, compare it, or export one client from it. It never touches the live database or the repository's contents.
#   run it in a one-off container of the cell database image, with the BACKUP_S3_* variables and an empty volume at /restore:
#   pitr-restore.sh                                  # newest state
#   pitr-restore.sh "2026-03-14 11:29:00+05:30"      # just before a mistake
# When you have what you need:  pg_ctl -D /restore/data stop
set -euo pipefail
target="${1:-}"
/usr/local/bin/pgbackrest-conf.sh
sed -i 's#^pg1-path=.*#pg1-path=/restore/data#' /etc/pgbackrest/pgbackrest.conf
mkdir -p /restore/data /restore/sock && chmod 700 /restore/data
args=(restore --delta)
[ -n "$target" ] && args+=(--type=time "--target=$target" --target-action=promote)
pgbackrest --config=/etc/pgbackrest/pgbackrest.conf --stanza=cell "${args[@]}"
# archiving stays OFF so this copy can never write into the real repository
pg_ctl -D /restore/data -o "-p 5499 -k /restore/sock -c archive_mode=off -c archive_command=/bin/true -c listen_addresses=''" -l /restore/pg.log -w start
echo "Restored${target:+ to $target}. Connect with: psql -h /restore/sock -p 5499 -U postgres -d erp"
