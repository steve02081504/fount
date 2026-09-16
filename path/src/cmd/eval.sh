#!/usr/bin/env bash
cmd_eval() {
	bootstrap_full "$@"
	require deno
	run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/scripts/eval.mjs" "${@:2}"
	exit $?
}
