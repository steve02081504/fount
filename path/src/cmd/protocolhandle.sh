#!/usr/bin/env bash
cmd_protocolhandle() {
	require passthrough browser unix/ipc unix/url
	handle_docker_termux_passthrough "$@"
	shift
	local protocolUrl="$1"
	if [[ "$protocolUrl" == "fount://nop/" ]]; then
		shift
		"$0" "$@"
		exit $?
	fi
	if [ -z "$protocolUrl" ]; then
		print_i18n_red 'protocol.noUrl' >&2
		exit 1
	fi
	test_browser
	install_ipc_tools || exit 1
	install_package "jq" "jq" || exit 1
	if [[ "$OS_TYPE" == "Linux" && $IN_TERMUX -eq 0 ]]; then install_package "xdg-open" "xdg-utils"; fi
	TARGET_URL="https://steve02081504.github.io/fount/protocol/?url=$(urlencode "$protocolUrl")"
	export TARGET_URL
	fount_background_open_when_ready
	shift
	"$0" "$@"
	exit $?
}

