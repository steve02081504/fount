#!/usr/bin/env bash
cmd_open() {
	require passthrough browser unix/url env
	shift
	handle_docker_passthrough open "$@"
	if [ -z "${FOUNT_INSTALL_WAIT:-}" ]; then
		open_url_in_browser 'https://steve02081504.github.io/fount/wait?cold_bootting=true'
	fi
	"$0" "$@"
	exit $?
}
