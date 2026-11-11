#!/bin/sh
# Launcher used by both the portable folder and the Debian package.
# Resolve symlinks so /usr/bin/minimax-code works.
set -e
SELF=$(readlink -f -- "$0")
DIR=$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)
# Electron reports app.isPackaged=false for this repackaged app when it is started
# without a desktop-session environment (for example from the application menu).
# The desktop UI then takes its source-checkout paths and its local service fails
# to start. Force the packaged paths for every launch.
export ELECTRON_FORCE_IS_PACKAGED=true
exec "$DIR/electron" "$@"
