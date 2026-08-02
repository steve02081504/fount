#!/usr/bin/env bash
# IDE terminal Shift+Enter keybinding patch

get_fount_terminal_keybindings_manifest_path() {
	echo "$FOUNT_DIR/data/installer/terminal_keybindings.json"
}

get_fount_editor_keybindings_paths() {
	local editor user_dir
	for editor in Cursor Code VSCodium; do
		case "$OS_TYPE" in
		Darwin) user_dir="$HOME/Library/Application Support/$editor/User" ;;
		Linux) user_dir="$HOME/.config/$editor/User" ;;
		*) return 0 ;;
		esac
		[ -d "$user_dir" ] && echo "$user_dir/keybindings.json"
	done
}

merge_fount_editor_keybindings() {
	local keybindings_path="$1"
	command -v jq &>/dev/null || return 1
	local parent patch merged entries before
	parent=$(dirname "$keybindings_path")
	mkdir -p "$parent"
	patch='{"key":"shift+enter","command":"workbench.action.terminal.sendSequence","args":{"text":"\u001b[13;2u"},"when":"terminalFocus","isfountPatch":true}'
	before='[]'
	if [ -f "$keybindings_path" ]; then
		before=$(jq -c '
			if type == "array" then .
			elif .keybindings? then .keybindings
			else [] end
		' "$keybindings_path" 2>/dev/null) || before='[]'
	fi
	entries=$(echo "$before" | jq -c --argjson patch "$patch" '
		map(select(.isfountPatch != true)) + [$patch]
	')
	merged=$(echo "$entries" | jq '.')
	[ "$before" = "$(echo "$entries" | jq -c '.')" ] && return 1
	echo "$merged" >"$keybindings_path"
	return 0
}

register_terminal_keybindings() {
	if [ "$OS_TYPE" != "Linux" ] && [ "$OS_TYPE" != "Darwin" ]; then return 0; fi
	command -v jq &>/dev/null || return 0
	mkdir -p "$INSTALLER_DATA_DIR"
	local manifest kb_path patched=false
	manifest=$(get_fount_terminal_keybindings_manifest_path)
	local editor_paths=()
	while IFS= read -r kb_path; do
		[ -n "$kb_path" ] || continue
		if merge_fount_editor_keybindings "$kb_path"; then
			editor_paths+=("$kb_path")
			patched=true
		fi
	done < <(get_fount_editor_keybindings_paths)
	if ! $patched; then return 0; fi
	printf '%s\n' "${editor_paths[@]}" | jq -R . | jq -s '{editorKeybindings: ., windowsTerminalSettings: []}' >"$manifest"
	get_i18n 'terminalKeybindings.registered'
}

