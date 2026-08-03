#!/usr/bin/env bash
# Docker / Termux passthrough helpers
# These functions shift their own $1 (command name) before re-invoking $0.

handle_docker_passthrough() {
	if in_docker; then
		shift
		"$0" "$@"
		exit $?
	fi
}

handle_docker_termux_passthrough() {
	if in_container; then
		shift
		"$0" "$@"
		exit $?
	fi
}

