#!/usr/bin/env bash
case "$OS_TYPE" in
Linux)
	rm -f "$HOME/.config/autostart/fount-background.desktop"
	;;
Darwin)
	plist="$HOME/Library/LaunchAgents/com.steve02081504.fount.background.plist"
	if [ -f "$plist" ]; then
		launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
		rm -f "$plist"
	fi
	;;
esac
