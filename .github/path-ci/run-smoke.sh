#!/usr/bin/env bash
# Path CLI smoke: server / background / log / reboot / install (init).
# Requires install-hooks.sh to have swapped JS entrypoints first.
set -euo pipefail

ROOT="${FOUNT_REPO_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)}"
cd "$ROOT"

FOUNT="${ROOT}/path/fount.sh"
MARKER='FOUNT_CI_HOOK:server'
LOG_MARKER='FOUNT_CI_HOOK:log'

assert_output_contains() {
	local name="$1"
	local expected="$2"
	local output="$3"
	if ! grep -Fq "$expected" <<< "$output"; then
		echo "[$name] expected output to contain: $expected" >&2
		echo "--- captured output ---" >&2
		echo "$output" >&2
		exit 1
	fi
	echo "[$name] ok"
}

run_capture() {
	# Path may print i18n / progress to stderr; merge for marker checks.
	"$@" 2>&1
}

echo "path smoke: repo=$ROOT"

touch .noupdate .noautoboot

if [ ! -x "$FOUNT" ]; then
	chmod +x "$FOUNT" "$ROOT/path/fount" 2>/dev/null || true
fi

if [ ! -d node_modules ]; then
	echo "path smoke: seeding node_modules via deno install (hooked entrypoint)"
	deno install --prod --allow-scripts --allow-all -c "$ROOT/deno.json" --entrypoint "$ROOT/src/server/index.mjs"
fi

echo "== server =="
out="$(run_capture "$FOUNT" server)"
assert_output_contains server "$MARKER" "$out"

echo "== reboot =="
out="$(run_capture "$FOUNT" reboot)"
assert_output_contains reboot "$MARKER" "$out"
assert_output_contains reboot 'reboot' "$out"

echo "== log =="
out="$(run_capture "$FOUNT" log)"
assert_output_contains log "$LOG_MARKER" "$out"

echo "== background =="
marker_file="$(mktemp)"
export FOUNT_CI_HOOK_MARKER_FILE="$marker_file"
"$FOUNT" background server
found=0
for _ in $(seq 1 60); do
	if [ -s "$marker_file" ] && grep -Fq "$MARKER" "$marker_file"; then
		found=1
		break
	fi
	sleep 0.5
done
rm -f "$marker_file"
unset FOUNT_CI_HOOK_MARKER_FILE
if [ "$found" -ne 1 ]; then
	echo "[background] timed out waiting for hook marker" >&2
	exit 1
fi
echo "[background] ok"

echo "== install (init) =="
rm -rf node_modules
run_capture "$FOUNT" init
if [ ! -d node_modules ]; then
	echo "[install] node_modules missing after init" >&2
	exit 1
fi
out="$(run_capture "$FOUNT" server)"
assert_output_contains install "$MARKER" "$out"

echo "path smoke: all passed"
