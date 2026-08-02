#!/usr/bin/env bash
fount_cmd_init() {
	if [ "${2:-}" = force ]; then
		fount_require fs init_force
		fount_handle_init_force "$@"
	fi
	fount_bootstrap_full "$@"
	write_taskbar_progress_clear
	exit 0
}
