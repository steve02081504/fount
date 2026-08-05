#!/usr/bin/env bash
cmd_update() {
	require_mid
	shift
	if [ -n "${1:-}" ]; then
		fount_update_to_ref "$1"
	else
		update_fount_and_deno
	fi
}
