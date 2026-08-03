#!/usr/bin/env bash
cmd_init() {
	if [ "${2:-}" = force ]; then
		require fs init_force
		fount_handle_init_force "$@"
	fi
	bootstrap_full "$@"
	write_taskbar_progress_clear
	exit 0
}
