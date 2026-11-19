#!/usr/bin/env bash
# Prints fresh secrets to paste into Dokploy's Environment tab. Run it on your own machine; keep the output out of git and shell history.
#   ./gen-secrets.sh cloud    for the control plane + gateway service  (see cloud.env.example)
#   ./gen-secrets.sh cell     for ONE pooled cell service               (see cell.env.example; run again for each cell)
# Keys are printed on one line with the line breaks written as \n, which the services accept.
set -euo pipefail
pem() { openssl genpkey -algorithm ed25519 | awk 'BEGIN{ORS="\\n"} {print}' | sed 's/\\n$//'; }
pub() { printf '%b' "$1" | openssl pkey -pubout | awk 'BEGIN{ORS="\\n"} {print}' | sed 's/\\n$//'; }
case "${1:-}" in
  cloud)
    LIC=$(pem); REL=$(pem)
    echo "CP_DB_PASSWORD=$(openssl rand -hex 24)"
    echo "LICENCE_PRIVATE_KEY=$LIC"
    echo "RELEASE_PRIVATE_KEY=$REL"
    echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)"
    echo "GATEWAY_TOKEN=$(openssl rand -hex 32)"
    echo "REQUIRE_STAFF_MFA=true"
    echo
    echo "# Not secret, but needed elsewhere. Keep a copy:"
    echo "# LICENCE_PUBLIC_KEY goes into every cell's settings (cell.env). RELEASE_PUBLIC_KEY goes on every site server (release-public.pem)."
    echo "# LICENCE_PUBLIC_KEY=$(pub "$LIC")"
    echo "# RELEASE_PUBLIC_KEY=$(pub "$REL")"
    ;;
  cell)
    echo "PG_SUPERUSER_PASSWORD=$(openssl rand -hex 24)"
    echo "MIGRATOR_PASSWORD=$(openssl rand -hex 24)"
    echo "APP_PASSWORD=$(openssl rand -hex 24)"
    echo "AUTH_JWT_PRIVATE_KEY=$(pem)"
    echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)"
    echo "PLATFORM_ADMIN_TOKEN=$(openssl rand -hex 32)"
    echo "# LICENCE_PUBLIC_KEY=<the control plane's licence public key from './gen-secrets.sh cloud'>"
    ;;
  *) echo "usage: $0 cloud|cell" >&2; exit 2 ;;
esac
