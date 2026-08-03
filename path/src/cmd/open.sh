#!/usr/bin/env bash
cmd_open() {
	require passthrough browser unix/ipc unix/url
	handle_docker_passthrough "$@"
	shift
	if [ -f "$FOUNT_DIR/data/config.json" ]; then
		TARGET_URL='https://steve02081504.github.io/fount/wait?cold_bootting=true'
		open_url_in_browser "$TARGET_URL"
		"$0" "$@"
		exit $?
	fi
	install_ipc_tools
	trap '[[ -n "$STATUS_SERVER_PID" ]] && kill "$STATUS_SERVER_PID" 2>/dev/null' EXIT
	if command -v nc &>/dev/null; then
		while true; do {
			while IFS= read -r -t 2 line && [[ "$line" != $'\r' ]]; do :; done
			echo -e "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"message\":\"pong\"}"
		} | nc -l 8930 -q 0 || break; done >/dev/null 2>&1 &
		STATUS_SERVER_PID=$!
	elif command -v socat &>/dev/null; then
		(socat -T 5 TCP-LISTEN:8930,reuseaddr,fork SYSTEM:"read; echo -e 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"message\":\"pong\"}'") >/dev/null 2>&1 &
		STATUS_SERVER_PID=$!
	fi

	if [[ -n "$STATUS_SERVER_PID" ]]; then
		URL='https://steve02081504.github.io/fount/wait/install'
		open_url_in_browser "$URL"
	else
		echo -e "${C_YELLOW}Warning: Could not start status server. Proceeding with standard installation.${C_RESET}"
	fi
	"$0" "$@"
	exit $?
}

