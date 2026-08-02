#!/usr/bin/env bash
fount_cmd_keepalive() {
	fount_bootstrap_server "$@"
	export FOUNT_KEEPALIVE=1
	trap 'write_taskbar_progress_clear; unset FOUNT_KEEPALIVE' EXIT INT TERM
	shift
	if [ "$1" = "debug" ]; then
		debug_on
		shift
	fi

	local start_time init_attempted restart_timestamps server_status
	local current_time elapsed_time three_minutes_ago temp_timestamps ts
	start_time=$(date +%s)
	init_attempted=0
	restart_timestamps=()

	"$0" server "$@"
	server_status=$?
	while [ "$server_status" -ne 0 ]; do
		if [ "$server_status" -eq 130 ]; then exit 130; fi
		if [ "$server_status" -ne 131 ]; then
			current_time=$(date +%s)
			elapsed_time=$((current_time - start_time))
			if [ "$elapsed_time" -lt 180 ] && [ "$init_attempted" -eq 1 ]; then
				print_i18n_red 'keepalive.failedToStart' >&2
				exit 1
			fi
			init_attempted=0

			restart_timestamps=("${restart_timestamps[@]}" "$current_time")

			three_minutes_ago=$((current_time - 180))
			temp_timestamps=()
			for ts in "${restart_timestamps[@]}"; do
				if [ "$ts" -ge "$three_minutes_ago" ]; then
					temp_timestamps+=("$ts")
				fi
			done
			restart_timestamps=("${temp_timestamps[@]}")

			if [ "${#restart_timestamps[@]}" -ge 7 ]; then
				handle_auto_reinitialization
				restart_timestamps=()
				init_attempted=1
			fi
		fi

		"$0" server
		server_status=$?
	done
	exit "$server_status"
}
