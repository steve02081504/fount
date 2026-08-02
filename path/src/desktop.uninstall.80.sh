#!/usr/bin/env bash
get_i18n 'remove.removing.desktopShortcut'
if [ "$OS_TYPE" = "Linux" ]; then
	rm -f "$HOME/.local/share/applications/fount.desktop"
	if command -v update-desktop-database &>/dev/null; then
		update-desktop-database "$HOME/.local/share/applications"
	fi
	get_i18n 'remove.desktopShortcutRemoved'
elif [ "$OS_TYPE" = "Darwin" ]; then
	rm -rf "$HOME/Desktop/fount.app"
	get_i18n 'remove.desktopShortcutRemoved'
fi

set_title "𝓯𝓸"
write_taskbar_progress 60
