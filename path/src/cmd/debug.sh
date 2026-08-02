#!/usr/bin/env bash
fount_cmd_debug() {
	trap 'write_taskbar_progress_clear' EXIT INT TERM
	shift
	"$0" keepalive debug "$@"
	exit $?
}

