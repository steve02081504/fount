#!/usr/bin/env bash
cmd_default() {
	bootstrap_full "$@"
	require unix/ipc
	trap_terminal_teardown
	if [ "$1" ]; then
		run "$@"
		exit $?
	elif in_container; then
		"$0" keepalive "$@"
		exit $?
	fi
	# 服务器已在运行则只启 log viewer，不再重复拉一个 keepalive（省一次无效服务器启动）。
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
