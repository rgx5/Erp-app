#!/usr/bin/env bash
# Makes the upload key for the Play Store and prints what to add as GitHub repository secrets. Run once, on your own computer.
#   bash scripts/android-upload-key.sh
# Keep the .jks file and both passwords somewhere safe and OFF the repository (a password manager). With Play App Signing, Google holds the real
# app-signing key; this is only the key that proves an upload came from you. If it is lost, Play support can reset it. It cannot be recovered by us.
set -euo pipefail
OUT="${1:-onesync-upload.jks}"
ALIAS="${ALIAS:-onesync-upload}"
command -v keytool >/dev/null || { echo "keytool not found: install a JDK (Java 17 or newer)"; exit 1; }
[ -e "$OUT" ] && { echo "$OUT already exists: not overwriting"; exit 1; }
read -rsp "Choose a keystore password (at least 8 characters): " PASS; echo
read -rp "Your name or company for the certificate [OneSyncERP]: " CN; CN="${CN:-OneSyncERP}"
keytool -genkeypair -v -keystore "$OUT" -alias "$ALIAS" -keyalg RSA -keysize 4096 -validity 10000 -storepass "$PASS" -keypass "$PASS" -dname "CN=$CN, O=$CN, C=IN"
echo
echo "Created $OUT. Add these four secrets at GitHub → Settings → Secrets and variables → Actions:"
echo "  ANDROID_KEYSTORE_BASE64   = $(base64 -w0 "$OUT" 2>/dev/null | cut -c1-24)…  (run: base64 -w0 $OUT   and paste the whole output)"
echo "  ANDROID_KEYSTORE_PASSWORD = the password you just typed"
echo "  ANDROID_KEY_ALIAS         = $ALIAS"
echo "  ANDROID_KEY_PASSWORD      = the same password"
