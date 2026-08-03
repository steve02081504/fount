#!/usr/bin/env bash
# Filesystem permission helpers

check_dir_writable() {
	local dir="$1"
	if [ ! -d "$dir" ]; then
		mkdir -p "$dir" 2>/dev/null || return 1
	fi
	[ -w "$dir" ]
}

assert_dir_writable() {
	local dir="$1"
	if ! check_dir_writable "$dir"; then
		if [ "$(id -u)" -eq 0 ]; then
			print_i18n_red 'install.permissionDeniedAsRoot' 'path' "$dir" >&2
		else
			print_i18n_red 'install.permissionDeniedNotRoot' 'path' "$dir" >&2
		fi
		exit 1
	fi
}

