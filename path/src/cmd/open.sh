#!/usr/bin/env bash
cmd_open() {
	require passthrough browser unix/ipc unix/url eula
	handle_docker_passthrough "$@"
	shift
	if [ -f "$FOUNT_DIR/data/config.json" ]; then
		TARGET_URL='https://steve02081504.github.io/fount/wait?cold_bootting=true'
		open_url_in_browser "$TARGET_URL"
		"$0" "$@"
		exit $?
	fi

	if fount_eula_env_accepted; then
		copy_fount_default_config
		"$0" "$@"
		exit $?
	fi

	if [[ ! -r /dev/tty ]]; then
		echo -e "${C_RED}EULA acceptance is required. Re-run with FOUNT_ACCEPT_EULA=1, or from an interactive terminal.${C_RESET}" >&2
		echo "$FOUNT_EULA_URL" >&2
		"$0" remove
		exit $?
	fi

	install_ipc_tools
	start_fount_status_server
	if [[ -z "${STATUS_SERVER_PID:-}" ]]; then
		echo -e "${C_YELLOW}Warning: Could not start status server. Proceeding with EULA prompt in this terminal.${C_RESET}"
	fi
	open_url_in_browser "$FOUNT_INSTALL_WAIT_URL"
	if ! confirm_fount_eula; then
		echo "EULA declined. Removing fount."
		stop_fount_status_server
		"$0" remove
		exit $?
	fi
	copy_fount_default_config
	"$0" "$@"
	exit_code=$?
	stop_fount_status_server
	exit $exit_code
}
