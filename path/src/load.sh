#!/usr/bin/env bash
# require: idempotent module loader
# Assumes FOUNT_SRC is set to "$FOUNT_DIR/path/src" by the entry script.
require() {
	local moduleName path marker
	for moduleName in "$@"; do
		marker=$(printf '%s' "$moduleName" | tr '/.-' '___')
		eval "[ \"\${FOUNT_LOADED_${marker}:-}\" = 1 ]" && continue
		path="$FOUNT_SRC/${moduleName}.sh"
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
	require unix/sed git update fs run debug desktop boot keybindings deno steam first_install
	install_deno
}

bootstrap_full() {
	require_mid
	fount_first_install_if_needed "$@"
}

bootstrap_server() {
	bootstrap_full "$@"
	assert_dir_writable "$FOUNT_DIR"
	update_fount_and_deno_background
	run_deno -V
}

# Source uninstall hooks under FOUNT_SRC, highest level first
source_uninstall_hooks() {
	local hook level
	while IFS= read -r hook; do
		# shellcheck disable=SC1090
		. "$hook"
	done < <(
		find "$FOUNT_SRC" -name '*.uninstall.*.sh' -print0 2>/dev/null |
			while IFS= read -r -d '' hookPath; do
				level=$(basename "$hookPath")
				level=${level##*.uninstall.}
				level=${level%.sh}
				printf '%s\t%s\n' "$level" "$hookPath"
			done | sort -t "$(printf '\t')" -k1,1nr -k2,2 | cut -f2-
	)
}

