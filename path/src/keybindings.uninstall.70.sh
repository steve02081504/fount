#!/usr/bin/env bash
get_i18n 'remove.removing.terminalKeybindings'
if { [ "$OS_TYPE" = "Linux" ] || [ "$OS_TYPE" = "Darwin" ]; } && command -v jq &>/dev/null; then
	manifest="$FOUNT_DIR/data/installer/terminal_keybindings.json"
	kb_paths=()
	if [ -f "$manifest" ]; then
		while IFS= read -r kb_path; do
			[ -n "$kb_path" ] && kb_paths+=("$kb_path")
		done < <(jq -r '.editorKeybindings[]? // empty' "$manifest" 2>/dev/null)
	fi
	for editor in Cursor Code VSCodium; do
		case "$OS_TYPE" in
		Darwin) user_dir="$HOME/Library/Application Support/$editor/User" ;;
		Linux) user_dir="$HOME/.config/$editor/User" ;;
		*) continue ;;
		esac
		[ -d "$user_dir" ] || continue
		kb_path="$user_dir/keybindings.json"
		found=0
		for existing in "${kb_paths[@]}"; do
			[ "$existing" = "$kb_path" ] && found=1 && break
		done
		[ "$found" -eq 0 ] && kb_paths+=("$kb_path")
	done
	for kb_path in "${kb_paths[@]}"; do
		[ -f "$kb_path" ] || continue
		filtered=$(jq -c 'map(select(.isfountPatch != true))' "$kb_path" 2>/dev/null) || continue
		if [ "$filtered" = "[]" ]; then
			rm -f "$kb_path"
		else
			echo "$filtered" | jq '.' >"$kb_path"
		fi
		get_i18n 'terminalKeybindings.editorRemoved' 'path' "$kb_path"
	done
	rm -f "$manifest"
fi
