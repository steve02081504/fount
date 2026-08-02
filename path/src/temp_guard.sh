#!/usr/bin/env bash
# Guard against running fount from a temporary directory
is_in_temp_dir() {
	local dir="$1"
	local resolved
	resolved=$(cd "$dir" 2>/dev/null && pwd -P) || resolved="$dir"

	case "$resolved" in
	/var/folders/*) return 0 ;;
	esac

	local tmp_candidate resolved_tmp
	for tmp_candidate in "${TMPDIR:-}" /tmp /var/tmp /private/tmp; do
		[ -n "$tmp_candidate" ] || continue
		resolved_tmp=$(cd "$tmp_candidate" 2>/dev/null && pwd -P) || resolved_tmp="$tmp_candidate"
		case "$resolved" in
		"$resolved_tmp" | "$resolved_tmp"/*) return 0 ;;
		esac
	done
	return 1
}

# Call early with the first command argument; exits if in a temp dir (except for remove)
check_temp_guard() {
	local cmd="${1:-}"
	if [ "$cmd" != "remove" ] && is_in_temp_dir "$FOUNT_DIR"; then
		get_i18n 'tempDir.blocked' >&2
		exit 1
	fi
}

