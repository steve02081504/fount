#!/usr/bin/env bash
# Termux-specific run() setup and teardown

fount_termux_run_setup() {
	if [[ $IN_TERMUX -ne 1 ]]; then
		return 0
	fi
	if [ -n "${LANG+set}" ]; then
		FOUNT_TERMUX_LANG_WAS_SET=1
		FOUNT_TERMUX_LANG_BACKUP="$LANG"
	else
		FOUNT_TERMUX_LANG_WAS_SET=0
	fi
	LANG="$(getprop persist.sys.locale)"
	export LANG
}

fount_termux_run_teardown() {
	if [[ $IN_TERMUX -ne 1 ]]; then
		return 0
	fi
	if [ "$FOUNT_TERMUX_LANG_WAS_SET" -eq 1 ]; then
		export LANG="$FOUNT_TERMUX_LANG_BACKUP"
	else
		unset LANG
	fi
}
