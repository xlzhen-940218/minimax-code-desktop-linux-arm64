#!/usr/bin/env bash
# Downloads the Electron runtime for this architecture.
set -euo pipefail

HERE="$(CDPATH= cd -- "$(dirname -- "$(readlink -f -- "$0")")/.." && pwd)"
ELECTRON_VERSION="${ELECTRON_VERSION:-42.11.16}"
ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://cdn.npmmirror.com/binaries}"

case "$(uname -m)" in
  aarch64 | arm64) ARCH=arm64 ;;
  x86_64 | amd64) ARCH=x64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [ -x "$HERE/electron/electron" ]; then
  echo "Electron runtime already present: $HERE/electron/electron"
  exit 0
fi

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v unzip >/dev/null || { echo "unzip is required" >&2; exit 1; }

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/minimax-code-desktop-src/downloads"
mkdir -p "$CACHE" "$HERE/electron"
ARCHIVE="$CACHE/electron-v$ELECTRON_VERSION-linux-$ARCH.zip"

echo "Downloading Electron $ELECTRON_VERSION (linux-$ARCH)"
if [ ! -s "$ARCHIVE" ]; then
  curl -fL --retry 3 \
    "$ELECTRON_MIRROR/electron/$ELECTRON_VERSION/electron-v$ELECTRON_VERSION-linux-$ARCH.zip" \
    -o "$ARCHIVE"
fi

unzip -q -o "$ARCHIVE" -d "$HERE/electron"
chmod +x "$HERE/electron/electron" "$HERE/electron/chrome-sandbox" 2>/dev/null || true
echo "Electron ready: $HERE/electron/electron"
