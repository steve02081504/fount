#!/usr/bin/env bash
cmd_update() {
	require_mid
	if [ -n "${2:-}" ]; then
		fount_update_to_ref "$2"
	else
		update_fount_and_deno
	fi
}
