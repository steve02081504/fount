#!/usr/bin/env bash
# Desktop shortcuts and protocol handler registration

get_fount_desktop_dir() {
	if [ -n "${XDG_DESKTOP_DIR:-}" ]; then
		printf '%s\n' "$XDG_DESKTOP_DIR"
		return
	fi
	if [ -f "$HOME/.config/user-dirs.dirs" ]; then
		local line val
		line=$(grep -E '^XDG_DESKTOP_DIR=' "$HOME/.config/user-dirs.dirs" 2>/dev/null | tail -n1) || true
		if [ -n "$line" ]; then
			val=${line#XDG_DESKTOP_DIR=}
			val=${val%\"}
			val=${val#\"}
			eval "printf '%s\n' $val"
			return
		fi
	fi
	printf '%s\n' "$HOME/Desktop"
}

# $1 = desktop dir, $2 = shortcut base name (desktop + 2 subfolder levels → find -maxdepth 3)
find_fount_desktop_shortcut_paths() {
	local desktop_dir="$1" name="$2"
	[ -d "$desktop_dir" ] || return 0
	find "$desktop_dir" -maxdepth 3 -name "$name" 2>/dev/null
}

remove_fount_desktop_shortcut_copies() {
	local name="$1" desktop_dir path removed=0
	desktop_dir=$(get_fount_desktop_dir)
	while IFS= read -r path; do
		[ -n "$path" ] || continue
		rm -rf "$path"
		removed=1
	done < <(find_fount_desktop_shortcut_paths "$desktop_dir" "$name")
	[ "$removed" -eq 1 ]
}

write_fount_linux_desktop_file() {
	local desktop_file_path="$1"
	mkdir -p "$(dirname "$desktop_file_path")"
	cat <<EOF >"$desktop_file_path"
[Desktop Entry]
Version=1.0
Type=Application
Name=fount
Comment=fount Application
Exec="$FOUNT_DIR/path/fount" open
Icon="$FOUNT_DIR/src/public/pages/favicon.ico"
Terminal=true
Categories=Utility;
EOF
	chmod +x "$desktop_file_path"
}

write_fount_macos_desktop_app() {
	local app_path="$1"
	local icon_path="$FOUNT_DIR/src/public/pages/favicon.ico"

	rm -rf "$app_path"
	mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources"
	local icns_path="$FOUNT_DIR/src/public/pages/favicon.icns"
	local icon_name="favicon.icns"
	if [ ! -f "$icns_path" ] && command -v sips &>/dev/null; then
		sips -s format icns "$icon_path" --out "$icns_path"
	fi
	if [ -f "$icns_path" ]; then
		cp "$icns_path" "$app_path/Contents/Resources/favicon.icns"
	else
		cp "$icon_path" "$app_path/Contents/Resources/favicon.ico"
		icon_name="favicon.ico"
	fi
	rm -f "$icns_path"

	cat <<EOF >"$app_path/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>fount-launcher</string>
	<key>CFBundleIconFile</key>
	<string>$icon_name</string>
	<key>CFBundleIdentifier</key>
	<string>com.steve02081504.fount</string>
	<key>CFBundleInfoDictionaryVersion</key>
	<string>6.0</string>
	<key>CFBundleName</key>
	<string>fount</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>1.0</string>
	<key>CFBundleSignature</key>
	<string>????</string>
	<key>CFBundleVersion</key>
	<string>1</string>
	<key>LSMinimumSystemVersion</key>
	<string>10.15</string>
	<key>NSPrincipalClass</key>
	<string>NSApplication</string>
	<key>LSUIElement</key>
	<false/>
	<key>CFBundleURLTypes</key>
	<array>
		<dict>
			<key>CFBundleURLName</key>
			<string>fount Protocol</string>
			<key>CFBundleURLSchemes</key>
			<array>
				<string>fount</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
EOF

	local temp_applescript_file="/tmp/fount_launcher_script.applescript"
	cat <<EOF >"$temp_applescript_file"
on run argv
	set fount_command_path to "$FOUNT_DIR/path/fount"
	set command_to_execute to quoted form of fount_command_path
	if (count of argv) is 0 then
		set command_to_execute to command_to_execute & " open"
	else
		repeat with i from 1 to count of argv
			set command_to_execute to command_to_execute & " " & quoted form of (item i of argv)
		end repeat
	end if

	set final_command_in_terminal to ":; (" & command_to_execute & "; echo; echo \"fount has exited. Press Enter to close this window...\"; read -r)"

	tell application "Terminal"
		activate
		do script final_command_in_terminal
	end tell
end run
EOF
	local compiled_applescript="$app_path/Contents/Resources/fount-launcher.scpt"
	if command -v osacompile &>/dev/null; then
		osacompile -o "$compiled_applescript" "$temp_applescript_file"
	else
		print_i18n_red 'shortcut.osacompileNotFound' >&2
		return 1
	fi

	local launcher_script="$app_path/Contents/MacOS/fount-launcher"
	cat <<EOF >"$launcher_script"
#!/usr/bin/env bash
SCRIPT_DIR="\$(dirname "\$0")"
osascript "\$SCRIPT_DIR/../Resources/fount-launcher.scpt" "\$@"
EOF
	chmod -R u+rwx "$app_path"
	xattr -dr com.apple.quarantine "$app_path"

	local LSREGISTER_PATH="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
	if [ -f "$LSREGISTER_PATH" ]; then
		if ! "$LSREGISTER_PATH" -f "$app_path"; then
			print_i18n_yellow 'shortcut.lsregisterFailed' >&2
			killall lsd
		fi
	else
		killall lsd
	fi

	if [ ! -d "$app_path" ]; then
		print_i18n_red 'shortcut.createDesktopAppFailed' >&2
		return 1
	fi
}

install_fount_desktop_shortcut_targets() {
	local name="$1" writer="$2"
	local desktop_dir default_path path paths=()
	desktop_dir=$(get_fount_desktop_dir)
	default_path="$desktop_dir/$name"
	while IFS= read -r path; do
		[ -n "$path" ] && paths+=("$path")
	done < <(find_fount_desktop_shortcut_paths "$desktop_dir" "$name")
	if [ "${#paths[@]}" -eq 0 ]; then
		paths=("$default_path")
	fi
	for path in "${paths[@]}"; do
		"$writer" "$path" || return 1
		get_i18n 'shortcut.desktopShortcutCreated' 'path' "$path"
	done
}

create_desktop_shortcut() {
	if [ "$OS_TYPE" = "Linux" ]; then
		install_package "xdg-open" "xdg-utils" || return 1

		local desktop_file_path="$HOME/.local/share/applications/fount.desktop"
		write_fount_linux_desktop_file "$desktop_file_path"
		get_i18n 'shortcut.desktopShortcutCreated' 'path' "$desktop_file_path"

		local protocol_desktop_file_path="$HOME/.local/share/applications/fount-protocol.desktop"
		mkdir -p "$(dirname "$protocol_desktop_file_path")"
		cat <<EOF >"$protocol_desktop_file_path"
[Desktop Entry]
Version=1.0
Type=Application
Name=fount Protocol Handler
Comment=Handles fount:// protocol links
Exec="$FOUNT_DIR/path/fount" protocolhandle %u
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/fount;
Categories=Utility;
EOF
		chmod +x "$protocol_desktop_file_path"
		xdg-mime default fount-protocol.desktop x-scheme-handler/fount 2>/dev/null || true
		if command -v update-desktop-database &>/dev/null; then
			update-desktop-database "$HOME/.local/share/applications"
		fi
		get_i18n 'shortcut.protocolHandlerRegistered'

	elif [ "$OS_TYPE" = "Darwin" ]; then
		install_fount_desktop_shortcut_targets "fount.app" write_fount_macos_desktop_app || return 1

	else
		print_i18n_yellow 'shortcut.shortcutNotSupported' 'os' "$OS_TYPE"
	fi
	return 0
}
