#!/usr/bin/env bash
fount_cmd_log() {
	fount_bootstrap_full "$@"
	run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/log_viewer/index.mjs"
	exit $?
}

