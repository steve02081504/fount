#!/usr/bin/env bash
cmd_server() {
	bootstrap_server "$@"
	trap_taskbar_clear
	shift
	if [ "$1" = "debug" ]; then
		debug_on
		shift
	fi
	run_server_with_updates "$@"
	exit $?
}
