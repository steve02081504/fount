#!/usr/bin/env bash
cmd_test() {
	bootstrap_full "$@"
	shift
	local original_title test_exit
	original_title=$(get_title)
	set_title '𝒻ℴ𝓊𝓃𝓉 𝓽𝓮𝓼𝓽'
	test_exit=0
	# shellcheck disable=SC2329
	test_cleanup() {
		set_title "$original_title"
		if [ "$test_exit" -eq 0 ]; then
			write_taskbar_progress_clear
		fi
		taskbar_progress_enabled && printf '\007'
	}
	trap 'test_cleanup' EXIT
	deno_upgrade canary
	if [ -z "${FOUNT_TEST_ALLOW_SLEEP:-}" ] && [[ " $* " != *" --watch "* ]]; then
		if command -v caffeinate >/dev/null 2>&1; then
			caffeinate -dims -w $$ &
		elif command -v systemd-inhibit >/dev/null 2>&1; then
			local deno_argv
			deno_argv=(deno)
			if [ "${IN_TERMUX:-0}" -eq 1 ]; then
				if command -v deno.glibc.sh &>/dev/null; then
					deno_argv=(deno.glibc.sh)
				elif command -v glibc-runner &>/dev/null; then
					deno_argv=(glibc-runner "$(command -v deno)")
				fi
			fi
			systemd-inhibit --what=idle:sleep:handle-lid-switch --who=fount-test \
				--why='fount test running' --mode=block \
				"${deno_argv[@]}" run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/scripts/test/cli.mjs" "$@"
			test_exit=$?
			exit $test_exit
		fi
	fi
	run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/scripts/test/cli.mjs" "$@"
	test_exit=$?
	exit $test_exit
}
