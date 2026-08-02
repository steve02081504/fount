#!/usr/bin/env bash
get_i18n 'remove.removing.fount.fromPath'
escaped_fount_dir=$(fount_sed_escape "$FOUNT_DIR")
while IFS= read -r profile_file; do
	if [ -f "$profile_file" ]; then
		# shellcheck disable=SC2016
		run_sed_inplace '/export PATH="\$PATH:'"$escaped_fount_dir"'\/path"/d' "$profile_file"
		if [ "$(tr -d '\n\r\t ' <"$profile_file" | wc -c)" -eq 0 ]; then
			rm -f "$profile_file"
		fi
	fi
done < <(get_profile_files)
PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$FOUNT_DIR/path" | tr '\n' ':' | sed 's/:*$//')
export PATH

set_title "𝓯𝓸𝓾𝓷"
write_taskbar_progress 25
