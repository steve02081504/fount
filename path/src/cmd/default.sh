#!/usr/bin/env bash
cmd_default() {
	bootstrap_full "$@"
	# `run` / `runas` 是 part 调用：终端标题与任务栏归调用方，这里不接管。
	# 服务器未运行时先拉起后台实例，再让 run 走 IPC 分派。
	if [ "$1" != run ] && [ "$1" != runas ]; then trap_terminal_teardown; fi
	if [ "$1" ]; then
		if [ "$1" = run ] || [ "$1" = runas ]; then
			require unix/ipc
			if ! test_fount_running; then
				"$0" background keepalive >/dev/null 2>&1 || return 1
				local attempt
				for ((attempt = 0; attempt < 300; attempt++)); do
					test_fount_running && break
					sleep 0.2
				done
				if ! test_fount_running; then echo 'fount server did not start in time' >&2; return 1; fi
			fi
		fi
		run "$@"
		exit $?
	elif in_container; then
		"$0" keepalive "$@"
		exit $?
	fi
	# 服务器已在运行则只启 log viewer，不再重复拉一个 keepalive（省一次无效服务器启动）。
	require unix/ipc
	if ! test_fount_running; then
		write_taskbar_progress 25
		set_title "𝓯"
		"$0" background keepalive "$@"
		set_title "𝓯𝓸"
		write_taskbar_progress
	fi
	"$0" log
	exit $?
}
