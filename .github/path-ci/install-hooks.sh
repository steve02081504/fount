#!/usr/bin/env bash
# Replace JS entrypoints with CI stubs (see hooks/). Local dev never runs this.
set -euo pipefail

ROOT="${1:?repo root}"
DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"

install_one() {
	local mod="$1"
	local file="$2"
	local hook="$3"
	local src="$ROOT/src/$mod/$file"
	local bak="$src.path-ci.bak"
	if [ ! -f "$src" ]; then
		echo "install-hooks: missing $src" >&2
		exit 1
	fi
	if [ ! -f "$hook" ]; then
		echo "install-hooks: missing hook $hook" >&2
		exit 1
	fi
	cp "$src" "$bak"
	cp "$hook" "$src"
}

install_one server index.mjs "$DIR/hooks/server.mjs"
install_one log_viewer index.mjs "$DIR/hooks/log_viewer.mjs"
