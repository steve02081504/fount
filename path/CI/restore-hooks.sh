#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:?repo root}"

restore_one() {
	local src="$1"
	local bak="$src.path-ci.bak"
	if [ -f "$bak" ]; then
		mv "$bak" "$src"
	fi
}

restore_one "$ROOT/src/server/index.mjs"
restore_one "$ROOT/src/log_viewer/index.mjs"
