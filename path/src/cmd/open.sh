#!/usr/bin/env bash
cmd_open() {
	require passthrough browser unix/ipc unix/url eula env
	shift
	if [ -f "$FOUNT_DIR/data/config.json" ]; then
		handle_docker_passthrough open "$@"
		open_url_in_browser 'https://steve02081504.github.io/fount/wait?cold_bootting=true'
		"$0" "$@"
		exit $?
	fi

	if fount_eula_env_accepted || in_docker; then
		copy_fount_default_config
		"$0" "$@"
		exit $?
	fi

	if [[ ! -r /dev/tty ]]; then
		print_i18n_red 'eula.required' >&2
		echo "$FOUNT_EULA_URL" >&2
		"$0" remove
		exit 1
	fi

	install_ipc_tools
	trap_terminal_teardown stop_fount_status_server
	start_fount_status_server
	if [[ -z "${STATUS_SERVER_PID:-}" ]]; then
		print_i18n_yellow 'eula.statusServerFailed'
	fi
	open_url_in_browser "$FOUNT_INSTALL_WAIT_URL"
	if ! confirm_fount_eula; then
		get_i18n 'eula.declined'
		stop_fount_status_server
		"$0" remove
		exit 1
	fi
	copy_fount_default_config
	"$0" "$@"
	exit_code=$?
	stop_fount_status_server
	exit $exit_code
}
