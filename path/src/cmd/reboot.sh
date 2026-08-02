#!/usr/bin/env bash
fount_cmd_reboot() {
	fount_trap_taskbar_clear
	run "$@"
	exit $?
}
