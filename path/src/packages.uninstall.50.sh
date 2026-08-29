#!/usr/bin/env bash
get_i18n 'remove.removing.installedSystemPackages'
if [[ $IN_TERMUX -eq 1 ]]; then
	for package in "${INSTALLED_PACMAN_PACKAGES_ARRAY[@]}"; do pacman -R --noconfirm "$package"; done
fi
load_installed_packages
for package in "${INSTALLED_SYSTEM_PACKAGES_ARRAY[@]}"; do uninstall_package "$package"; done

if [ -f "$AUTO_INSTALLED_DENO_FLAG" ]; then
	get_i18n 'remove.uninstalling.deno'
	rm -rf "$HOME/.deno"
	for profile_file in $(get_profile_files); do
		if [ -f "$profile_file" ]; then run_sed_inplace '/\.deno/d' "$profile_file"; fi
	done
	PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$HOME/.deno/bin" | tr '\n' ':' | sed 's/:*$//')
	export PATH
	rm -f "$AUTO_INSTALLED_DENO_FLAG"
fi
set_title "𝓯𝓸"
write_taskbar_progress 60
