#!/usr/bin/env bash
# Login autostart for background keepalive

register_boot_background() {
	if in_container; then
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
		cat >"$desk" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=fount background
Comment=fount background keepalive at login
Exec=/bin/bash -l -c "exec '$launcher' background keepalive"
Terminal=false
Categories=Utility;
X-GNOME-Autostart-enabled=true
EOF
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
		if ! launchctl bootstrap "gui/$(id -u)" "$plist"; then
			echo -e "${C_YELLOW}Warning: launchctl bootstrap failed for ${plist}${C_RESET}" >&2
			return 1
		fi
		;;
	esac
}
