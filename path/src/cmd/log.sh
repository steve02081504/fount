#!/usr/bin/env bash
cmd_log() {
	bootstrap_full "$@"
	require unix/termux
	termux_ensure_sensor_api
	run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/log_viewer/index.mjs" "${@:2}"
	exit $?
}
