#!/usr/bin/env bash
cmd_server() {
	bootstrap_server "$@"
	trap_taskbar_clear
	shift
	run_server "$@"
	exit $?
}
