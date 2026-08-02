#!/usr/bin/env bash
fount_cmd_default() {
	fount_trap_terminal_teardown
	if [ "$1" ]; then
		run "$@"
		exit $?
	elif fount_in_container; then
		"$0" keepalive "$@"
		exit $?
	fi
	write_taskbar_progress 25
	set_title "𝓯"
	"$0" background keepalive "$@"
	set_title "𝓯𝓸"
	write_taskbar_progress
	"$0" log
	exit $?
}
