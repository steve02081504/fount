#!/usr/bin/env bash
# IPC helpers: nc/socat installer + background open-after-server script
install_ipc_tools() {
	install_package "nc" "netcat gnu-netcat openbsd-netcat netcat-openbsd nmap-ncat" || install_package "socat" "socat"
}

# Expects TARGET_URL to be exported by the caller.
read -r -d '' BACKGROUND_IPC_JOB <<'BGJOB'
fount_ipc_internal() {
	local type="$1" data="$2" hostname="${3:-localhost}" port="${4:-16698}"
	local cmd_json="{\"type\":\"$type\",\"data\":$data}" response=""
	if command -v nc &>/dev/null; then
		response=$(echo "$cmd_json" | nc -w 3 "$hostname" "$port" 2>/dev/null)
	elif command -v socat &>/dev/null; then
		response=$(echo "$cmd_json" | socat -T 3 - TCP:"$hostname":"$port",nodelay 2>/dev/null)
	fi
	if [ -z "$response" ]; then return 1; fi
	local status
	status=$(echo "$response" | jq -r '.status // empty')
	if [ "$status" = "ok" ]; then return 0; else return 1; fi
}
test_fount_running_internal() { fount_ipc_internal "ping" "{}"; }

timeout=60 elapsed=0
while ! test_fount_running_internal; do
	sleep 1; elapsed=$((elapsed + 1))
	if [ "$elapsed" -ge "$timeout" ]; then
		echo "Error: fount server did not start in time." >&2; exit 1
	fi
done
OS_TYPE=$(uname -s)
if [[ -d "/data/data/com.termux" ]]; then
	termux-open-url "$TARGET_URL" >/dev/null 2>&1
elif [ "$OS_TYPE" = "Linux" ]; then
	xdg-open "$TARGET_URL" >/dev/null 2>&1
elif [ "$OS_TYPE" = "Darwin" ]; then
	open "$TARGET_URL" >/dev/null 2>&1
fi
BGJOB

fount_background_open_when_ready() {
	nohup bash -c "$BACKGROUND_IPC_JOB" >/dev/null 2>&1 &
}
