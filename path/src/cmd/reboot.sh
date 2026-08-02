#!/usr/bin/env bash
fount_cmd_reboot() {
	fount_bootstrap_full "$@"
	fount_trap_taskbar_clear
	run "$@"
	exit $?
}
