#!/bin/bash
# Runs next to the database (same image, same data volume and socket). Registers the database with the repository, then every day takes a backup
# (a full one every BACKUP_FULL_DAY, a differential otherwise), checks the repository's checksums, and writes its result to /status/backup.json,
# which the API turns into the backup-age metrics. Old backups are expired by this job only after a successful new one.
set -uo pipefail
/usr/local/bin/pgbackrest-conf.sh
cfg=(--config=/etc/pgbackrest/pgbackrest.conf --stanza=cell)
status() { # ok, message
  local base wal; base=$(pgbackrest "${cfg[@]}" info --output=json 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);b=[x for s in d for x in s.get("backup",[])];print(max((x["timestamp"]["stop"] for x in b),default=0))' 2>/dev/null || echo 0)
  wal=$(psql -h /var/run/postgresql -U postgres -d erp -Atc "SELECT coalesce(extract(epoch FROM last_archived_time)::bigint,0) FROM pg_stat_archiver" 2>/dev/null || echo 0)
  printf '{"ok":%s,"message":"%s","at":%s,"lastBaseBackupAt":%s,"lastWalShippedAt":%s}\n' "$1" "$2" "$(date +%s)" "${base:-0}" "${wal:-0}" > /status/backup.json.tmp && mv /status/backup.json.tmp /status/backup.json
}
until pgbackrest "${cfg[@]}" stanza-create >/dev/null 2>&1 && pgbackrest "${cfg[@]}" check >/dev/null 2>&1; do status false "waiting for the repository: stanza or archive check failing"; sleep 30; done
while true; do
  type=diff; [ "$(date -u +%u)" = "${BACKUP_FULL_DAY:-7}" ] && type=full
  have=$(pgbackrest "${cfg[@]}" info --output=json 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);print(sum(len(s.get("backup",[])) for s in d))' 2>/dev/null || echo 0)
  [ "${have:-0}" = "0" ] && type=full
  if pgbackrest "${cfg[@]}" backup --type=$type && pgbackrest "${cfg[@]}" verify && pgbackrest "${cfg[@]}" expire; then status true "$type backup and verification succeeded"; else status false "$type backup or verification failed: see this container's log"; fi
  # tonight again; a failed run is retried every hour until it passes
  if grep -q '"ok":true' /status/backup.json; then sleep "${BACKUP_INTERVAL_SECONDS:-86400}"; else sleep 3600; fi
done
