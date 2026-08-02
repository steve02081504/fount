#!/usr/bin/env bash
# Deno server runner + keepalive helpers

handle_auto_reinitialization() {
	if [ -f "$FOUNT_DIR/.noautoinit" ]; then
		print_i18n_yellow 'keepalive.autoInitDisabled' >&2
		exit 1
	fi
	print_i18n_yellow 'keepalive.restartingTooFast' >&2

	if ! ("$0" init); then
		print_i18n_red 'keepalive.initFailed' >&2
		exit 1
	fi
	get_i18n 'keepalive.initComplete'
}

run() {
	local original_title exit_code
	if [[ $(id -u) -eq 0 ]]; then
		print_i18n_yellow 'install.rootWarning1' >&2
		print_i18n_yellow 'install.rootWarning2' >&2
	fi
	write_taskbar_progress 5
	original_title=$(get_title)
	set_title ""
	if [[ $IN_TERMUX -eq 1 ]]; then
		local LANG_BACKUP
		LANG_BACKUP="$LANG"
		LANG="$(getprop persist.sys.locale)"
		export LANG
		local SQsacPath="/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu/root/.bashrc"
		if [[ -f "$SQsacPath" ]] && grep -q "bash /root/sac.sh" "$SQsacPath"; then
			run_sed_inplace '/bash \/root\/sac.sh/d' "$SQsacPath"
			run_sed_inplace '/proot-distro login ubuntu/d' "/data/data/com.termux/files/home/.bashrc"
		fi
	fi
	local v8_flags=""
	if [[ -n "$FOUNT_V8_FLAGS" ]]; then
		v8_flags="$FOUNT_V8_FLAGS"
	fi
	local heap_size_mb=100 config_path heap_size_bytes calculated_mb
	config_path="$FOUNT_DIR/data/config.json"
	if [ -f "$config_path" ] && command -v jq &>/dev/null; then
		heap_size_bytes=$(jq -r '.prelaunch.heapSize // "0"' "$config_path")
		calculated_mb=$(( (heap_size_bytes + 524288) / 1048576 ))
		if [ "$calculated_mb" -gt 0 ]; then
			heap_size_mb=$calculated_mb
		fi
	fi
	if [[ -n "$v8_flags" ]]; then
		v8_flags="$v8_flags,--initial-heap-size=${heap_size_mb}"
	else
		v8_flags="--initial-heap-size=${heap_size_mb}"
	fi
	write_taskbar_progress 10
	if [ -z "$FOUNT_START_TIME" ]; then
		FOUNT_START_TIME=$(_fount_timestamp)
	fi
	export FOUNT_START_TIME
	FOUNT_DENO_START_TIME=$(_fount_timestamp)
	export FOUNT_DENO_START_TIME
	write_taskbar_progress 25
	set_title "𝓯"
	local boosted=0
	if [[ $(id -u) -eq 0 ]]; then
		renice -n -10 -p $$ >/dev/null 2>&1 && boosted=1
	fi
	if [[ "$OS_TYPE" = "Linux" ]] && command -v ionice >/dev/null 2>&1; then
		ionice -c2 -n0 -p $$ >/dev/null 2>&1 || true
	fi
	export FOUNT_STARTUP_PRIORITY_BOOST=1
	if [[ ${FOUNT_DEBUG:-0} -eq 1 ]]; then
		run_deno run --allow-scripts --allow-all --inspect-brk -c "$FOUNT_DIR/deno.json" --v8-flags="$v8_flags" "$FOUNT_DIR/src/server/index.mjs" "$@"
	else
		run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --v8-flags="$v8_flags" "$FOUNT_DIR/src/server/index.mjs" "$@"
	fi
	exit_code=$?
	if [[ "$boosted" -eq 1 ]]; then
		renice -n 0 -p $$ >/dev/null 2>&1 || true
	fi
	unset FOUNT_STARTUP_PRIORITY_BOOST
	set_title "$original_title"
	unset FOUNT_START_TIME
	unset FOUNT_DENO_START_TIME
	if [ "$exit_code" -ne 0 ] && [ "$exit_code" -ne 130 ]; then
		write_taskbar_progress_error
	fi
	if [[ $IN_TERMUX -eq 1 ]]; then export LANG="$LANG_BACKUP"; fi
	return $exit_code
}

run_shutdown() {
	run "$@"
}

# Run server; repeat after self-update when deno exits 131
run_server_with_updates() {
	local server_status
	run "$@"
	server_status=$?
	# Self-update restart runs bare server — not "$@". e.g. `fount run shell/install x`
	# must not re-run install after crash recovery.
	while [ "$server_status" -eq 131 ]; do
		update_fount_and_deno
		run
		server_status=$?
	done
	return "$server_status"
}

