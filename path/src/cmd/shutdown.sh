#!/usr/bin/env bash
cmd_shutdown() {
	bootstrap_full "$@"
	trap_taskbar_clear
	run "$@"
	exit $?
}
