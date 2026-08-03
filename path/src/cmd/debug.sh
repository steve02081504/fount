#!/usr/bin/env bash
cmd_debug() {
	bootstrap_full "$@"
	trap 'write_taskbar_progress_clear' EXIT INT TERM
	shift
	"$0" keepalive debug "$@"
	exit $?
}

