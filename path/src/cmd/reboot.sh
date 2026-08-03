#!/usr/bin/env bash
cmd_reboot() {
	bootstrap_full "$@"
	trap_taskbar_clear
	run "$@"
	exit $?
}
