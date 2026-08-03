#!/usr/bin/env bash
get_i18n 'remove.removing.protocolHandler'
if [ "$OS_TYPE" = "Linux" ]; then
	rm -f "$HOME/.local/share/applications/fount-protocol.desktop"
	if (command -v xdg-mime &>/dev/null); then
		xdg-mime default '' x-scheme-handler/fount 2>/dev/null || true
	elif [ -f "$HOME/.config/mimeapps.list" ]; then
		fount_require unix/sed
		run_sed_inplace '/x-scheme-handler\/fount=/d' "$HOME/.config/mimeapps.list"
	fi
	if command -v update-desktop-database &>/dev/null; then
		update-desktop-database "$HOME/.local/share/applications"
	fi
fi
