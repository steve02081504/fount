#!/usr/bin/env bash
cmd_background() {
	require passthrough
	export FOUNT_BACKGROUND=1
	handle_docker_termux_passthrough "$@"
	shift
	if [ -f "$FOUNT_DIR/.nobackground" ]; then
		if command -v xterm &>/dev/null; then
			xterm -e "$0" "$@" &
		elif command -v gnome-terminal &>/dev/null; then
			gnome-terminal -- "$0" "$@"
		elif command -v terminator &>/dev/null; then
			terminator -- "$0" "$@"
		elif command -v konsole &>/dev/null; then
			konsole -- "$0" "$@"
		elif command -v xfce4-terminal &>/dev/null; then
			xfce4-terminal -- "$0" "$@"
		elif command -v lxterminal &>/dev/null; then
			lxterminal -- "$0" "$@"
		else
			echo -e "${C_RED}Error: No terminal emulator found.${C_RESET}" >&2
			nohup "$0" "$@" >/dev/null 2>&1 &
		fi
	else
		nohup "$0" "$@" >/dev/null 2>&1 &
	fi
	unset FOUNT_BACKGROUND
	exit 0
}
