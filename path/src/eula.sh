#!/usr/bin/env bash
# First-run EULA gate (ensure_fount_config / Ensure-FountConfig when data/config.json is missing).

FOUNT_EULA_URL="https://steve02081504.github.io/fount/EULA/"
FOUNT_INSTALL_WAIT_URL="https://steve02081504.github.io/fount/wait/install/?from=runner"
export FOUNT_EULA_URL FOUNT_INSTALL_WAIT_URL

fount_eula_env_accepted() {
	case "${FOUNT_ACCEPT_EULA:-}" in
	1 | true | TRUE | yes | YES) return 0 ;;
	esac
	return 1
}

copy_fount_default_config() {
	local dest="$FOUNT_DIR/data/config.json"
	[ -f "$dest" ] && return 0
	mkdir -p "$FOUNT_DIR/data"
	cp "$FOUNT_DIR/default/config.json" "$dest"
}

write_fount_status_handler() {
	FOUNT_STATUS_HANDLER=$(mktemp)
	cat >"$FOUNT_STATUS_HANDLER" <<'EOF'
#!/usr/bin/env bash
req=""
IFS= read -r req || true
req="${req%$'\r'}"
method="${req%% *}"
req_rest="${req#* }"
req_path="${req_rest%% *}"
req_path="${req_path%%\?*}"
[[ "$req_path" == */ && "$req_path" != / ]] && req_path="${req_path%/}"
origin=""
while IFS= read -r -t 2 line && [[ "$line" != $'\r' && -n "$line" ]]; do
	line="${line%$'\r'}"
	case "$line" in
	[Oo][Rr][Ii][Gg][Ii][Nn]:*)
		origin="${line#*:}"
		origin="${origin#"${origin%%[![:space:]]*}"}"
		origin="${origin%"${origin##*[![:space:]]}"}"
		;;
	esac
done
if [[ "$method" == GET && "$req_path" == /eula && "$origin" == https://steve02081504.github.io ]]; then
	: > "${EULA_ACCEPT_FILE}"
fi
msg=pong
eula=pending
if [[ -f "${EULA_ACCEPT_FILE}" ]]; then
	msg=accepted
	eula=accepted
fi
printf 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: https://steve02081504.github.io\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{"message":"%s","eula":"%s"}' "$msg" "$eula"
EOF
	chmod +x "$FOUNT_STATUS_HANDLER"
}

start_fount_status_server() {
	EULA_ACCEPT_FILE="${EULA_ACCEPT_FILE:-${TMPDIR:-/tmp}/fount-eula-accepted-$$}"
	export EULA_ACCEPT_FILE
	rm -f "$EULA_ACCEPT_FILE"
	write_fount_status_handler
	if command -v socat &>/dev/null; then
		socat -T 5 TCP-LISTEN:8930,reuseaddr,fork EXEC:"$FOUNT_STATUS_HANDLER" >/dev/null 2>&1 &
		STATUS_SERVER_PID=$!
	elif command -v nc &>/dev/null; then
		FOUNT_STATUS_FIFO=$(mktemp -u)
		mkfifo "$FOUNT_STATUS_FIFO"
		(
			nc_q=""
			if nc -h 2>&1 | grep -q -- '-q'; then nc_q="-q 0"; fi
			while true; do
				# shellcheck disable=SC2086,SC2094 # nc fifo: same path is stdin of nc and stdout of the handler
				nc -l 8930 $nc_q <"$FOUNT_STATUS_FIFO" 2>/dev/null | "$FOUNT_STATUS_HANDLER" >"$FOUNT_STATUS_FIFO" || break
			done
		) >/dev/null 2>&1 &
		STATUS_SERVER_PID=$!
	fi
}

# wait/install polls :8930; keep the flag until stop so cmd_open does not open a second tab.
begin_fount_install_wait() {
	export FOUNT_INSTALL_WAIT=1
}

stop_fount_status_server() {
	if [[ -n "${STATUS_SERVER_PID:-}" ]]; then
		kill "$STATUS_SERVER_PID" 2>/dev/null
		STATUS_SERVER_PID=""
	fi
	unset FOUNT_INSTALL_WAIT
	[ -n "${FOUNT_STATUS_HANDLER:-}" ] && rm -f "$FOUNT_STATUS_HANDLER"
	[ -n "${FOUNT_STATUS_FIFO:-}" ] && rm -f "$FOUNT_STATUS_FIFO"
	[ -n "${EULA_ACCEPT_FILE:-}" ] && rm -f "$EULA_ACCEPT_FILE"
}

ensure_fount_config() {
	[ -f "$FOUNT_DIR/data/config.json" ] && return 0
	if fount_eula_env_accepted || in_docker; then
		copy_fount_default_config
		return 0
	fi
	require browser unix/ipc unix/url
	if [[ ! -r /dev/tty ]]; then
		print_i18n_red 'eula.required' >&2
		echo "$FOUNT_EULA_URL" >&2
		exit 1
	fi
	install_ipc_tools
	trap_terminal_teardown stop_fount_status_server
	start_fount_status_server
	if [[ -z "${STATUS_SERVER_PID:-}" ]]; then
		print_i18n_yellow 'eula.statusServerFailed'
	fi
	begin_fount_install_wait
	open_url_in_browser "$FOUNT_INSTALL_WAIT_URL"
	if ! confirm_fount_eula; then
		get_i18n 'eula.declined'
		stop_fount_status_server
		exit 1
	fi
	copy_fount_default_config
}

confirm_fount_eula() {
	if fount_eula_env_accepted; then return 0; fi
	if [[ -n "${EULA_ACCEPT_FILE:-}" && -f "$EULA_ACCEPT_FILE" ]]; then return 0; fi
	if ! open_controlling_tty; then
		print_i18n_red 'eula.required' >&2
		echo "$FOUNT_EULA_URL" >&2
		exit 1
	fi
	get_i18n 'eula.prompt'
	if [ -t 1 ]; then
		printf '\033]8;;%s\033\\%s\033]8;;\033\\\n' "$FOUNT_EULA_URL" "$FOUNT_EULA_URL"
	else
		echo "$FOUNT_EULA_URL"
	fi
	printf '%s' "$(get_i18n 'eula.yn')"
	local key=""
	while true; do
		if [[ -f "$EULA_ACCEPT_FILE" ]]; then
			exec 9<&-
			echo Y
			return 0
		fi
		if read -r -t 1 -n 1 -s key <&9; then
			case "$key" in
			y | Y)
				: >"$EULA_ACCEPT_FILE"
				exec 9<&-
				echo Y
				return 0
				;;
			n | N)
				exec 9<&-
				echo N
				return 1
				;;
			esac
		fi
	done
}
