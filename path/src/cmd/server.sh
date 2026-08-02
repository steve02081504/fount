#!/usr/bin/env bash
fount_cmd_server() {
	fount_trap_taskbar_clear
	shift
	if [ "$1" = "debug" ]; then
		debug_on
		shift
	fi
	run_server_with_updates "$@"
	exit $?
}
