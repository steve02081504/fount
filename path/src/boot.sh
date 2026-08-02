#!/usr/bin/env bash
# Login autostart for background keepalive

register_boot_background() {
	if fount_in_container; then
		return 0
	fi
	if [ -f "$FOUNT_DIR/.noautoboot" ]; then
		return 0
	fi
	local launcher="$FOUNT_DIR/path/fount"
	case "$OS_TYPE" in
	Linux)
		mkdir -p "$HOME/.config/autostart"
		local desk="$HOME/.config/autostart/fount-background.desktop"
		{
			echo '[Desktop Entry]'
			echo 'Version=1.0'
			echo 'Type=Application'
			echo 'Name=fount background'
			echo 'Comment=fount background keepalive at login'
			printf 'Exec=/bin/bash -l -c "exec '\''%s'\'' background keepalive"\n' "$launcher"
			echo 'Terminal=false'
			echo 'Categories=Utility;'
			echo 'X-GNOME-Autostart-enabled=true'
		} >"$desk"
		chmod +x "$desk"
		;;
	Darwin)
		local plist="$HOME/Library/LaunchAgents/com.steve02081504.fount.background.plist"
		mkdir -p "$HOME/Library/LaunchAgents"
		local shell_cmd shell_cmd_esc
		shell_cmd=$(printf "exec '%s' background keepalive" "$launcher")
		shell_cmd_esc=$(printf '%s' "$shell_cmd" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')
		launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
		cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.steve02081504.fount.background</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>-l</string>
		<string>-c</string>
		<string>$shell_cmd_esc</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
EOF
		launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null || true
		;;
	esac
}

remove_boot_background() {
	case "$OS_TYPE" in
	Linux)
		rm -f "$HOME/.config/autostart/fount-background.desktop"
		;;
	Darwin)
		local plist="$HOME/Library/LaunchAgents/com.steve02081504.fount.background.plist"
		if [ -f "$plist" ]; then
			launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
			rm -f "$plist"
		fi
		;;
	esac
}
