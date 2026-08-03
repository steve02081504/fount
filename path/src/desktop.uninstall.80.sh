#!/usr/bin/env bash
get_i18n 'remove.removing.desktopShortcut'
if [ "$OS_TYPE" = "Linux" ]; then
	if [ -f "$HOME/.local/share/applications/fount.desktop" ]; then
		rm -f "$HOME/.local/share/applications/fount.desktop"
		if command -v update-desktop-database &>/dev/null; then
			update-desktop-database "$HOME/.local/share/applications"
		fi
		get_i18n 'remove.desktopShortcutRemoved'
	else
		get_i18n 'remove.desktopShortcutNotFound'
	fi
elif [ "$OS_TYPE" = "Darwin" ]; then
	if remove_desktop_shortcut_copies "fount.app"; then
		get_i18n 'remove.desktopShortcutRemoved'
	else
		get_i18n 'remove.desktopShortcutNotFound'
	fi
fi

set_title "𝓯𝓸"
write_taskbar_progress 60
