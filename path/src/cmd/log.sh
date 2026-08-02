#!/usr/bin/env bash
fount_cmd_log() {
	run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/log_viewer/index.mjs"
	exit $?
}

