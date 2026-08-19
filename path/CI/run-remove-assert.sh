#!/usr/bin/env bash
# Copy this directory out of FOUNT_DIR first — `remove` deletes the install tree.
# usage: bash run-remove-assert.sh <fount-entry>
set -euo pipefail
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
out=$(mktemp)
if "$1" remove >"$out" 2>&1; then
	exit_code=0
else
	exit_code=$?
fi
cat "$out"
bash "$here/assert-remove-clean.sh" "$here/remove-noise.patterns" "$out"
rm -f "$out"
exit "$exit_code"
