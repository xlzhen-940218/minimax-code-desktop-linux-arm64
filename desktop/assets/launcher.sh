#!/bin/sh
# Launcher used by both the portable folder and the Debian package.
# Resolve symlinks so /usr/bin/minimax-code works.
set -e
SELF=$(readlink -f -- "$0")
DIR=$(CDPATH= cd -- "$(dirname -- "$SELF")" && pwd)
exec "$DIR/electron" "$@"
