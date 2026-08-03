#!/usr/bin/env bash
# First-time dependency install (node_modules via deno install)

fount_first_install_if_needed() {
	if [[ ! -d "$FOUNT_DIR/node_modules" || "${1:-}" = 'init' ]]; then
		if [ ! -f "$FOUNT_DIR/.noupdate" ]; then
			install_package "git" "git git-core" || true
			git_reset_and_clean
		fi
		if [[ -d "$FOUNT_DIR/node_modules" ]]; then run shutdown; fi
		mkdir -p "$FOUNT_DIR/node_modules"
		write_taskbar_progress 70
		get_i18n 'install.installingDependencies'
		run_deno install --prod --reload --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --entrypoint "$FOUNT_DIR/src/server/index.mjs"
		write_taskbar_progress 85
		if ! fount_in_container; then
			create_desktop_shortcut
			register_boot_background
			register_terminal_keybindings
		fi
		echo -e "${C_GREEN}======================================================${C_RESET}"
		print_i18n_yellow 'install.untrustedPartsWarning'
		echo -e "${C_GREEN}======================================================${C_RESET}"
		write_taskbar_progress_clear
	fi
}

