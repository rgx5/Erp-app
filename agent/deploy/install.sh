#!/usr/bin/env bash
# Turns a clean Ubuntu LTS server into a OneSyncERP site. Safe to run again (it never overwrites secrets it already made).
#
#   sudo ./install.sh --control-plane https://control.example.in --agent-token cpa_... --release-public-key release-public.pem \
#                     --registry registry.example.in/onesync --first-release-env release.env --bundle /path/to/bundle \
#                     --backup-json backup.json --backup-key-file backup-cipher.pass   (from the control plane: POST /sites/:id/backup-key)
#
# The bundle directory holds: docker-compose.site.yml, Caddyfile, bootstrap.sql (from backend/db/bootstrap), agent/ (built agent: dist/ and package.json).
# It sets up encrypted backups (pgBackRest, key per client) with the bundle's agent/dist/backup-cli.js and systemd timers. It does NOT open the tunnel (tunnel client, later).
set -euo pipefail

CONTROL_PLANE="" AGENT_TOKEN="" RELEASE_KEY="" REGISTRY="" FIRST_RELEASE="" BUNDLE="" BACKUP_JSON="" BACKUP_KEY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --control-plane) CONTROL_PLANE="$2"; shift 2 ;;
    --agent-token) AGENT_TOKEN="$2"; shift 2 ;;
    --release-public-key) RELEASE_KEY="$2"; shift 2 ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --first-release-env) FIRST_RELEASE="$2"; shift 2 ;;
    --bundle) BUNDLE="$2"; shift 2 ;;
    --backup-json) BACKUP_JSON="$2"; shift 2 ;;
    --backup-key-file) BACKUP_KEY="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
for v in CONTROL_PLANE AGENT_TOKEN RELEASE_KEY REGISTRY FIRST_RELEASE BUNDLE BACKUP_JSON BACKUP_KEY; do
  [ -n "${!v}" ] || { echo "missing --$(echo "$v" | tr 'A-Z_' 'a-z-')" >&2; exit 2; }
done
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 2; }
. /etc/os-release
[ "${ID:-}" = ubuntu ] || { echo "this installer supports Ubuntu LTS only (found ${ID:-unknown})" >&2; exit 2; }

rand() { head -c "$1" /dev/urandom | base64 | tr -d '=+/\n' | head -c "$2"; }
say() { printf '\n== %s\n' "$*"; }

say "Packages"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
command -v node >/dev/null 2>&1 || { apt-get install -y nodejs; }
apt-get install -y openssh-server unattended-upgrades

say "Directories and the support account"
install -d -m 0750 /etc/onesync /opt/onesync /var/lib/onesync /var/lib/onesync/pgdata /var/lib/onesync/caddy
id onesync-support >/dev/null 2>&1 || useradd --create-home --shell /bin/bash onesync-support
install -d -m 0700 -o onesync-support -g onesync-support /home/onesync-support/.ssh
: > /home/onesync-support/.ssh/authorized_keys   # closed until a customer approves a session
chown onesync-support:onesync-support /home/onesync-support/.ssh/authorized_keys; chmod 0600 /home/onesync-support/.ssh/authorized_keys
passwd -l onesync-support >/dev/null

say "Application files"
cp "$BUNDLE/docker-compose.site.yml" "$BUNDLE/Caddyfile" /opt/onesync/
install -m 0755 "$BUNDLE/bin/onesync-backup" "$BUNDLE/bin/onesync-restore" /usr/local/bin/
rm -rf /opt/onesync/agent && cp -r "$BUNDLE/agent" /opt/onesync/agent
cp "$RELEASE_KEY" /etc/onesync/release-public.pem
[ -f /etc/onesync/release.env ] || cp "$FIRST_RELEASE" /etc/onesync/release.env

say "Secrets (made once, never overwritten)"
make_secret() { [ -s "$1" ] || { umask 077; printf '%s' "$2" > "$1"; }; }
make_secret /etc/onesync/pg-admin.pass "$(rand 48 32)"
make_secret /etc/onesync/migrator.pass "$(rand 48 32)"
make_secret /etc/onesync/app.pass "$(rand 48 32)"
make_secret /etc/onesync/platform-admin.token "$(rand 64 48)"
make_secret /etc/onesync/data-encryption.key "$(head -c 32 /dev/urandom | base64)"
if [ ! -s /etc/onesync/jwt.key ]; then (umask 077; openssl genpkey -algorithm ed25519 -out /etc/onesync/jwt.key); fi
make_secret /etc/onesync/agent.token "$AGENT_TOKEN"
PGA=$(cat /etc/onesync/pg-admin.pass); MIG=$(cat /etc/onesync/migrator.pass); APP=$(cat /etc/onesync/app.pass)
(umask 077
 printf 'POSTGRES_PASSWORD=%s\n' "$PGA" > /etc/onesync/postgres.env
 printf 'MIGRATOR_DATABASE_URL=postgresql://erp_migrator:%s@postgres:5432/erp\n' "$MIG" > /etc/onesync/migrator.env
 { printf 'DATABASE_URL=postgresql://erp_app:%s@postgres:5432/erp\n' "$APP"
   printf 'PLATFORM_ADMIN_TOKEN=%s\nDATA_ENCRYPTION_KEY=%s\n' "$(cat /etc/onesync/platform-admin.token)" "$(cat /etc/onesync/data-encryption.key)"
   printf 'AUTH_JWT_PRIVATE_KEY=%s\n' "$(awk '{printf "%s\\n", $0}' /etc/onesync/jwt.key)"
   printf 'CORS_ALLOWED_ORIGINS=app://onesync\n'; } > /etc/onesync/api.env
 cat > /etc/onesync/agent.env <<ENV
CONTROL_PLANE_URL=$CONTROL_PLANE
AGENT_TOKEN_FILE=/etc/onesync/agent.token
RELEASE_PUBLIC_KEY_FILE=/etc/onesync/release-public.pem
PLATFORM_ADMIN_TOKEN_FILE=/etc/onesync/platform-admin.token
IMAGE_REGISTRY=$REGISTRY
ENV
)

say "Backups: key and configuration"
install -m 0600 "$BACKUP_KEY" /etc/onesync/backup-cipher.pass
install -m 0600 "$BACKUP_JSON" /etc/onesync/backup.json
# the configuration holds the key, so it is written for the database user (uid 999 in the postgres image) only
BACKUP_JSON=/etc/onesync/backup.json node /opt/onesync/agent/dist/backup-cli.js write-config
chown 999:999 /etc/onesync/pgbackrest.conf; chmod 0600 /etc/onesync/pgbackrest.conf
install -d -o 999 -g 999 -m 0750 /var/lib/onesync/backup-repo

say "Database"
COMPOSE="docker compose -f /opt/onesync/docker-compose.site.yml --env-file /etc/onesync/release.env"
$COMPOSE up -d postgres
until $COMPOSE exec -T postgres pg_isready -U postgres -d erp >/dev/null 2>&1; do sleep 2; done
$COMPOSE exec -T postgres psql -U postgres -d erp -v ON_ERROR_STOP=1 -v migrator_password="$MIG" -v app_password="$APP" < "$BUNDLE/bootstrap.sql"
# Migrate with the migration image named in the first release (the agent does this for every later release).
MIGRATE_IMAGE=$(grep '^MIGRATE_IMAGE=' /etc/onesync/release.env | cut -d= -f2-)
[ -n "$MIGRATE_IMAGE" ] || { echo "release.env must name MIGRATE_IMAGE" >&2; exit 1; }
docker run --rm --network onesync_default --env-file /etc/onesync/migrator.env "$MIGRATE_IMAGE"

say "Application"
$COMPOSE up -d
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8080/health/ready >/dev/null 2>&1 && break; sleep 3; done
curl -fsS http://127.0.0.1:8080/health/ready >/dev/null || { echo "the application did not become ready" >&2; exit 1; }

say "First backup"
onesync-backup init
onesync-backup now first-install --full
onesync-backup verify

say "Agent"
cp "$BUNDLE/onesync-agent.service" /etc/systemd/system/onesync-agent.service
for u in onesync-backup.service onesync-backup.timer onesync-backup-full.service onesync-backup-full.timer onesync-backup-status.service onesync-backup-status.timer; do cp "$BUNDLE/$u" /etc/systemd/system/; done
systemctl daemon-reload
systemctl enable --now onesync-agent onesync-backup.timer onesync-backup-full.timer onesync-backup-status.timer
echo
echo "Done. The agent will report to $CONTROL_PLANE within a minute."
echo "Office computers must trust the certificate authority in /var/lib/onesync/caddy/pki/authorities/local/root.crt"
