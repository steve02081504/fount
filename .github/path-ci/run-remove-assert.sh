#!/usr/bin/env bash
# Copy this directory out of FOUNT_DIR first — `remove` deletes the install tree.
# usage: bash run-remove-assert.sh <fount-entry>
set -euo pipefail
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
entry=$1
out=$(mktemp)
set +e
"$entry" remove >"$out" 2>&1
ec=$?
set -e
cat "$out"
bash "$here/assert-remove-clean.sh" "$here/remove-noise.patterns" "$out"
rm -f "$out"
exit "$ec"
