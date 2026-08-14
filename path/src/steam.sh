#!/usr/bin/env bash
# Steam non-Steam shortcut register / unregister via path/src/steam.mjs

run_fount_steam_js() {
	local action="$1" out line
	out=$(run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/path/src/steam.mjs" "$action" "$FOUNT_DIR" 2>/dev/null) || true
	line=$(printf '%s\n' "$out" | grep '^FOUNT_STEAM:' | tail -n1) || true
	printf '%s' "${line#FOUNT_STEAM:}"
}

register_fount_steam() {
	in_container && return 0
	local payload status
	payload=$(run_fount_steam_js probe)
	status=$(printf '%s' "$payload" | grep -o '"status":"[^"]*"' | head -n1)
	[ "$status" = '"status":"ready"' ] || return 0
	get_i18n 'steam.registering'
	payload=$(run_fount_steam_js register)
	status=$(printf '%s' "$payload" | grep -o '"status":"[^"]*"' | head -n1)
	case "$status" in
	'"status":"ok"') get_i18n 'steam.registered' ;;
	'"status":"error"')
		print_i18n_yellow 'steam.failed' 'message' "$payload" >&2
		;;
	esac
	return 0
}

unregister_fount_steam() {
	local payload status action
	payload=$(run_fount_steam_js probe)
	status=$(printf '%s' "$payload" | grep -o '"status":"[^"]*"' | head -n1)
	[ "$status" = '"status":"ready"' ] || return 0
	get_i18n 'remove.removing.steamShortcut'
	payload=$(run_fount_steam_js unregister)
	status=$(printf '%s' "$payload" | grep -o '"status":"[^"]*"' | head -n1)
	action=$(printf '%s' "$payload" | grep -o '"action":"[^"]*"' | head -n1)
	if [ "$status" = '"status":"ok"' ] && [ "$action" = '"action":"removed"' ]; then
		get_i18n 'remove.steamShortcutRemoved'
		return 0
	fi
	if [ "$status" = '"status":"error"' ]; then
		print_i18n_yellow 'steam.failed' 'message' "$payload" >&2
		return 0
	fi
	get_i18n 'remove.steamShortcutNotFound'
}
