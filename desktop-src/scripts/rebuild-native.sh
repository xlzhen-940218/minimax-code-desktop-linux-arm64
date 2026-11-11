#!/usr/bin/env bash
# Rebuilds the native modules against this Electron release. npm installs them
# for Node, while Electron ships a different ABI, so they have to be compiled
# again before the app can start.
set -euo pipefail

HERE="$(CDPATH= cd -- "$(dirname -- "$(readlink -f -- "$0")")/.." && pwd)"
ELECTRON_VERSION="${ELECTRON_VERSION:-42.11.16}"
ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://cdn.npmmirror.com/binaries}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
MODULES=(better-sqlite3 node-pty)

case "$(uname -m)" in
  aarch64 | arm64) ARCH=arm64 ;;
  x86_64 | amd64) ARCH=x64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

command -v g++ >/dev/null || { echo "g++ is required" >&2; exit 1; }
command -v make >/dev/null || { echo "make is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

TOOLS="${XDG_CACHE_HOME:-$HOME/.cache}/minimax-code-desktop-src/tools"
NODE_GYP="$TOOLS/node_modules/.bin/node-gyp"
if [ ! -x "$NODE_GYP" ]; then
  echo "Installing node-gyp"
  mkdir -p "$TOOLS"
  (cd "$TOOLS" && npm install --no-save --registry "$NPM_REGISTRY" node-gyp@11 >/dev/null)
fi

HEADERS_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/minimax-code-desktop-src/headers/node-v$ELECTRON_VERSION"
if [ ! -d "$HEADERS_DIR" ]; then
  echo "Downloading Electron $ELECTRON_VERSION headers"
  mkdir -p "$(dirname "$HEADERS_DIR")"
  ARCHIVE="$(dirname "$HEADERS_DIR")/node-v$ELECTRON_VERSION-headers.tar.gz"
  [ -s "$ARCHIVE" ] || curl -fL --retry 3 \
    "$ELECTRON_MIRROR/electron/$ELECTRON_VERSION/node-v$ELECTRON_VERSION-headers.tar.gz" \
    -o "$ARCHIVE"
  mkdir -p "$HEADERS_DIR"
  tar -xzf "$ARCHIVE" -C "$HEADERS_DIR" --strip-components=1
fi

for module in "${MODULES[@]}"; do
  dir="$HERE/node_modules/$module"
  if [ ! -d "$dir" ]; then
    echo "missing $dir, run scripts/setup.sh first" >&2
    exit 1
  fi
  echo "Building $module for Electron $ELECTRON_VERSION ($ARCH)"
  (cd "$dir" && "$NODE_GYP" rebuild \
    --target="$ELECTRON_VERSION" --arch="$ARCH" --nodedir="$HEADERS_DIR" --jobs=max)
done
