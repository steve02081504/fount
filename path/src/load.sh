#!/usr/bin/env bash
# require: idempotent module loader
# Assumes FOUNT_SRC is set to "$FOUNT_DIR/path/src" by the entry script.
require() {
	local m path marker
	for m in "$@"; do
		marker=$(printf '%s' "$m" | tr '/.-' '___')
		eval "[ \"\${FOUNT_LOADED_${marker}:-}\" = 1 ]" && continue
		path="$FOUNT_SRC/${m}.sh"
		if [ ! -f "$path" ]; then
			echo "require: missing $path" >&2
			return 1
		fi
		# shellcheck disable=SC1090
		. "$path"
		eval "FOUNT_LOADED_${marker}=1"
	done
}

# Runtime modules: deno, run, git, desktop hooks, … (no first-install pass)
require_mid() {
	require unix/sed git update fs run debug desktop boot keybindings deno first_install
	install_deno
}

bootstrap_full() {
	require_mid
	fount_first_install_if_needed "$@"
}

bootstrap_server() {
	bootstrap_full "$@"
	assert_dir_writable "$FOUNT_DIR"
	update_fount_and_deno
	run_deno -V
}

# Source uninstall hooks under FOUNT_SRC, highest level first
source_uninstall_hooks() {
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

