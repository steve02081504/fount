#!/usr/bin/env bash
# fount_require: idempotent module loader
# Assumes FOUNT_SRC is set to "$FOUNT_DIR/path/src" by the entry script.
fount_require() {
	local m path marker
	for m in "$@"; do
		marker=$(printf '%s' "$m" | tr '/.-' '___')
		eval "[ \"\${FOUNT_LOADED_${marker}:-}\" = 1 ]" && continue
		path="$FOUNT_SRC/${m}.sh"
		if [ ! -f "$path" ]; then
			echo "fount_require: missing $path" >&2
			return 1
		fi
		# shellcheck disable=SC1090
		. "$path"
		eval "FOUNT_LOADED_${marker}=1"
	done
}

# Shared bootstrap after early passthrough commands
fount_require_mid() {
	fount_require unix/sed git update fs run debug desktop boot keybindings deno first_install
	install_deno
}

# Re-exec fount dropping the first N arguments (bash 3.2 safe)
fount_reexec_drop() {
	local n=$1
	shift
	while [ "$n" -gt 0 ]; do
		shift
		n=$((n - 1))
	done
	"$0" "$@"
	exit $?
}

# Source uninstall hooks under FOUNT_SRC, highest level first
fount_source_uninstall_hooks() {
	local hook lv
	while IFS= read -r hook; do
		# shellcheck disable=SC1090
		. "$hook"
	done < <(
		find "$FOUNT_SRC" -name '*.uninstall.*.sh' -print0 2>/dev/null |
			while IFS= read -r -d '' f; do
				lv=$(basename "$f")
				lv=${lv##*.uninstall.}
				lv=${lv%.sh}
				printf '%s\t%s\n' "$lv" "$f"
			done | sort -t "$(printf '\t')" -k1 -nr | cut -f2-
	)
}

