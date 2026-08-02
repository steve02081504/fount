#!/usr/bin/env bash
fount_cmd_clean() {
	fount_bootstrap_full "$@"
	if [ -d "$FOUNT_DIR/node_modules" ]; then
		run shutdown
		if [ "$2" = 'force' ]; then
			find "$FOUNT_DIR" -name "*_cache.json" -type f -delete
		fi
	fi
	rm -rf "$FOUNT_DIR/data/test"
	get_i18n 'clean.cleaningDenoCaches'
	run_deno clean -e "$FOUNT_DIR/src/server/index.mjs"
	write_taskbar_progress_clear
}

