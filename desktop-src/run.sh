#!/bin/sh
# Runs the app straight from the editable source tree.
set -e
HERE=$(CDPATH= cd -- "$(dirname -- "$(readlink -f -- "$0")")" && pwd)

if [ ! -x "$HERE/electron/electron" ] || [ ! -d "$HERE/node_modules" ]; then
  echo "Dependencies are not installed yet. Run ./scripts/setup.sh first." >&2
  exit 1
fi

# Electron reports app.isPackaged=false for an app started from a directory.
# The desktop UI would then take its source-checkout paths and the local service
# would fail to start, so keep the packaged behaviour for this tree as well.
export ELECTRON_FORCE_IS_PACKAGED=true

# Without this the runtime would copy better-sqlite3 into the user data
# directory and ask prebuild-install for a binary. The module next to this tree
# is already compiled against the bundled Electron, so point at it directly.
export MAVIS_SQLITE3_MODULE_PATH="$HERE/node_modules/better-sqlite3"
export NODE_PATH="$HERE/node_modules${NODE_PATH:+:$NODE_PATH}"

exec "$HERE/electron/electron" "$HERE/app" "$@"
