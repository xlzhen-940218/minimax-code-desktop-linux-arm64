#!/usr/bin/env bash
# Installs dependencies, downloads the Electron runtime, and compiles the native
# modules. Run once after cloning, and again after changing ELECTRON_VERSION.
set -euo pipefail

HERE="$(CDPATH= cd -- "$(dirname -- "$(readlink -f -- "$0")")/.." && pwd)"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

command -v node >/dev/null || { echo "Node.js is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required (found $(node -v))" >&2
  exit 1
fi

cd "$HERE"
if [ -f package-lock.json ]; then
  echo "Installing JavaScript dependencies"
  npm ci --omit=dev --legacy-peer-deps --registry "$NPM_REGISTRY"
else
  echo "Installing JavaScript dependencies (no lockfile)"
  npm install --omit=dev --legacy-peer-deps --registry "$NPM_REGISTRY"
fi

"$HERE/scripts/setup-electron.sh"

# The packaged app keeps its runtime resources next to app.asar. When running
# from this tree the same files have to sit below the Electron resources dir.
mkdir -p "$HERE/electron/resources/resources"
if [ ! -d "$HERE/electron/resources/resources/mcode-tools" ]; then
  cp -a "$HERE/resources/mcode-tools" "$HERE/electron/resources/resources/"
fi

"$HERE/scripts/rebuild-native.sh"

echo
echo "Ready. Start the app with ./run.sh"
