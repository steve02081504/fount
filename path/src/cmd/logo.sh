#!/usr/bin/env bash
fount_cmd_logo() {
	fount_require deno terminal
	install_deno
	local icon_anime="$FOUNT_DIR/imgs/icon_anime/index.mjs"
	local original_title logo_status subcommand
	subcommand="${2:-}"
	original_title=$(get_title)
	set_title "𝒻ℴ𝓊𝓃𝓉 𝓵𝓸𝓰𝓸"
	if [ "$subcommand" = watch ]; then
		run_deno run --watch --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$icon_anime"
	else
		run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$icon_anime"
	fi
	logo_status=$?
	set_title "$original_title"
	exit "$logo_status"
}
