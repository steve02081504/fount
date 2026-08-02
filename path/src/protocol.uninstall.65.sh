#!/usr/bin/env bash
get_i18n 'remove.removing.protocolHandler'
if [ "$OS_TYPE" = "Linux" ]; then
	rm -f "$HOME/.local/share/applications/fount-protocol.desktop"
	xdg-mime default '' x-scheme-handler/fount 2>/dev/null || true
	if command -v update-desktop-database &>/dev/null; then
		update-desktop-database "$HOME/.local/share/applications"
	fi
fi
