#!/usr/bin/env bash
# Termux-specific helpers (sensor API for logo/log/server)

# Ensure termux-sensor CLI (pkg termux-api); tracked for uninstall. Soft-fail if missing.
termux_ensure_sensor_api() {
	[[ $IN_TERMUX -eq 1 ]] || return 0
	command -v termux-sensor &>/dev/null && return 0
	require packages
	install_package "termux-sensor" "termux-api" || true
}

