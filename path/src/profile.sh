#!/usr/bin/env bash
# Shell profile PATH integration

get_profile_files() {
	printf "%s\\n" "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile"
}

ensure_fount_path() {
	if [[ ":$PATH:" != *":$FOUNT_DIR/path:"* ]]; then
		if [ ! -f "$HOME/.profile" ]; then
			touch "$HOME/.profile"
		fi
		for profile_file in $(get_profile_files); do
			if [ -f "$profile_file" ] && ! grep -q "export PATH=.*$FOUNT_DIR/path" "$profile_file"; then
				if [ "$(tail -c 1 "$profile_file")" != $'\n' ]; then echo >>"$profile_file"; fi
				echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >>"$profile_file"
			fi
		done
		export PATH="$PATH:$FOUNT_DIR/path"
	fi
}

