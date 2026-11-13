#!/usr/bin/env bash
# Verified build: fetch every input from its official source, check it against
# the publisher's checksum, then run build-linux.sh with no third-party mirrors.
#
#   - MiniMax installer: file.cdn.minimax.io, sha512 checked against MiniMax's
#     own update feed (latest.yml).
#   - Electron runtime + headers: official GitHub release / artifacts.electronjs.org,
#     sha256 checked against Electron's SHASUMS256.txt.
#   - npm packages: registry.npmjs.org. ELECTRON_MIRROR points at an invalid host,
#     so nothing can be fetched from a mirror behind your back.
#
# Usage: ./desktop/build-linux-verified.sh [--installer <path>] [--portable]
set -euo pipefail

HERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

FEED_URL="${FEED_URL:-https://file.cdn.minimax.io/public/minimax-agent-prod/release/latest.yml}"
CDN_BASE="${CDN_BASE:-https://file.cdn.minimax.io/public/minimax-agent-prod/release}"
ELECTRON_VERSION="${ELECTRON_VERSION:-42.11.16}"
NPM_REGISTRY="https://registry.npmjs.org"
BUILD_DIR="${BUILD_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/minimax-code-linux-build}"

usage() {
  cat <<EOF
Usage: $0 [--installer <path>] [--portable]

  --installer <path>  Use an installer you already downloaded (still sha512-checked
                      against the current feed, so it must be the current release).
  --portable          Also produce a portable .tar.gz.

Environment: ELECTRON_VERSION (default $ELECTRON_VERSION), BUILD_DIR, DEB_COMPRESS.
EOF
}

INSTALLER=""
PORTABLE=()
while [ $# -gt 0 ]; do
  case "$1" in
    --installer) INSTALLER="${2:?missing value}"; shift 2 ;;
    --portable) PORTABLE=(--portable); shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "Do not run the build as root. Only 'apt install' needs sudo."
case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) die "Unsupported architecture: $(uname -m)" ;;
esac
for c in curl sha256sum python3; do
  command -v "$c" >/dev/null 2>&1 || die "Missing required command: $c"
done

mkdir -p "$BUILD_DIR/installers" "$BUILD_DIR/cache"

# 1. Installer, checked against MiniMax's update feed ---------------------------
log "Reading MiniMax's update feed"
FEED="$(curl -fsSL --retry 3 "$FEED_URL")" || die "Could not read $FEED_URL"
VERSION="$(printf '%s\n' "$FEED" | sed -n 's/^version:[[:space:]]*//p' | head -1 | tr -d "\"' \r")"
SETUP_NAME="MiniMax Code Setup $VERSION.exe"
EXPECTED_SHA512="$(printf '%s\n' "$FEED" | awk -v n="$SETUP_NAME" '
  index($0, "url:") && index($0, n) {hit=1; next}
  hit && /sha512:/ {sub(/.*sha512:[[:space:]]*/, ""); gsub(/["\047\r ]/, ""); print; exit}')"
[ -n "$VERSION" ] && [ -n "$EXPECTED_SHA512" ] || die "Could not read version/sha512 from the feed."
log "Current MiniMax Code release: $VERSION"

if [ -z "$INSTALLER" ]; then
  INSTALLER="$BUILD_DIR/installers/$SETUP_NAME"
  if [ ! -f "$INSTALLER" ]; then
    log "Downloading the official installer"
    curl -fL --retry 3 -o "$INSTALLER.part" "$CDN_BASE/MiniMax%20Code%20Setup%20$VERSION.exe"
    mv "$INSTALLER.part" "$INSTALLER"
  fi
fi
[ -f "$INSTALLER" ] || die "Installer not found: $INSTALLER"

log "Checking installer sha512"
ACTUAL_SHA512="$(python3 -I -c '
import sys, hashlib, base64
h = hashlib.sha512()
with open(sys.argv[1], "rb") as f:
    for chunk in iter(lambda: f.read(1 << 20), b""):
        h.update(chunk)
print(base64.b64encode(h.digest()).decode())' "$INSTALLER")"
[ "$ACTUAL_SHA512" = "$EXPECTED_SHA512" ] \
  || die "Installer checksum mismatch. Delete $INSTALLER and run again; do not use this file."
echo "OK: installer matches MiniMax's published sha512."

# 2. Electron runtime + headers, checked against Electron's SHASUMS ------------
E="$ELECTRON_VERSION"
ZIP="electron-v$E-linux-$ARCH.zip"
HDR="node-v$E-headers.tar.gz"
cd "$BUILD_DIR/cache"

log "Fetching Electron $E (linux-$ARCH) from the official GitHub release"
curl -fsSL --retry 3 -o SHASUMS256.txt \
  "https://github.com/electron/electron/releases/download/v$E/SHASUMS256.txt"
[ -f "$ZIP" ] || curl -fL --retry 3 -o "$ZIP" \
  "https://github.com/electron/electron/releases/download/v$E/$ZIP"
grep -E "[ *]$ZIP\$" SHASUMS256.txt | sed 's/ \*/  /' | sha256sum -c - \
  || die "Electron runtime checksum mismatch."

log "Fetching Electron $E headers from artifacts.electronjs.org"
curl -fsSL --retry 3 -o HEADERS-SHASUMS256.txt \
  "https://artifacts.electronjs.org/headers/dist/v$E/SHASUMS256.txt"
[ -f "$HDR" ] || curl -fL --retry 3 -o "$HDR" \
  "https://artifacts.electronjs.org/headers/dist/v$E/$HDR"
grep -E "[ *]$HDR\$" HEADERS-SHASUMS256.txt | sed 's/ \*/  /' | sha256sum -c - \
  || die "Electron headers checksum mismatch."
# build-linux.sh looks for the headers under this name.
cp -f "$HDR" "electron-v$E-headers.tar.gz"
cd - >/dev/null

# 3. Build with official sources only -----------------------------------------
log "Running build-linux.sh (official npm registry, no mirrors)"
BUILD_DIR="$BUILD_DIR" \
npm_config_registry="$NPM_REGISTRY" \
ELECTRON_MIRROR="https://invalid.invalid" \
  "$HERE/build-linux.sh" \
    --installer "$INSTALLER" --arch "$ARCH" --electron-version "$E" \
    --registry "$NPM_REGISTRY" "${PORTABLE[@]}"

( cd "$HERE/dist" && sha256sum ./*"$VERSION"* > "SHA256SUMS-$VERSION.txt" )
log "Checksums of the outputs: $HERE/dist/SHA256SUMS-$VERSION.txt"
