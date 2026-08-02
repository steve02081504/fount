#!/usr/bin/env bash
fount_cmd_shutdown() {
	fount_trap_taskbar_clear
	run "$@"
	exit $?
}
