#!/usr/bin/env bash
# Termux-specific run() setup and teardown

# Ensure termux-sensor CLI (pkg termux-api); tracked for uninstall. Soft-fail if missing.
termux_ensure_sensor_api() {
	[[ $IN_TERMUX -eq 1 ]] || return 0
	command -v termux-sensor &>/dev/null && return 0
	require packages
	install_package "termux-sensor" "termux-api" || true
}

termux_run_setup() {
	if [[ $IN_TERMUX -ne 1 ]]; then
		return 0
	fi
	termux_ensure_sensor_api
	if [ -n "${LANG+set}" ]; then
		TERMUX_LANG_WAS_SET=1
		TERMUX_LANG_BACKUP="$LANG"
	else
		TERMUX_LANG_WAS_SET=0
	fi
	LANG="$(getprop persist.sys.locale)"
	export LANG
}

termux_run_teardown() {
	if [[ $IN_TERMUX -ne 1 ]]; then
		return 0
	fi
	if [ "$TERMUX_LANG_WAS_SET" -eq 1 ]; then
		export LANG="$TERMUX_LANG_BACKUP"
	else
		unset LANG
	fi
}
