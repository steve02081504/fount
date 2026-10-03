#!/usr/bin/env bash
get_i18n 'remove.removing.fount.fromPath'
escaped_dir=$(sed_escape "$FOUNT_DIR")
# 旧版本把临时 bin 目录写进过 profile，升级到这里的用户仍需要清理掉。
escaped_temp_bin=$(sed_escape "${TMPDIR:-${TMP:-${TEMP:-/tmp}}}/fount/bin")
while IFS= read -r profile_file; do
	if [ -f "$profile_file" ]; then
		# shellcheck disable=SC2016
		run_sed_inplace '/export PATH="\$PATH:'"$escaped_dir"'\/path"/d' "$profile_file"
		# shellcheck disable=SC2016
		run_sed_inplace '/export PATH="\$PATH:'"$escaped_temp_bin"'"/d' "$profile_file"
		if [ "$(tr -d '\n\r\t ' <"$profile_file" | wc -c)" -eq 0 ]; then
			rm -f "$profile_file"
		fi
	fi
done < <(get_profile_files)
PATH=$(echo "$PATH" | tr ':' '\n' | grep -v -e "$FOUNT_DIR/path" -e "${TMPDIR:-${TMP:-${TEMP:-/tmp}}}/fount/bin" | tr '\n' ':' | sed 's/:*$//')
export PATH

set_title "𝓯𝓸𝓾𝓷"
write_taskbar_progress 25
