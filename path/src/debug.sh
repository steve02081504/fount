#!/usr/bin/env bash
# Chrome DevTools helper for FOUNT_DEBUG

debug_on() {
	FOUNT_DEBUG=1
	export FOUNT_DEBUG
	if [[ $OS_TYPE == "Darwin" ]]; then
		if [ -d "/Applications/Google Chrome.app" ]; then
			open -a "Google Chrome" --new --args --new-window
			osascript -e 'tell application "Google Chrome" to tell the active tab of its first window to set URL to "chrome://inspect"'
		fi
	else
		local browser
		if command -v google-chrome &>/dev/null; then
			browser="google-chrome"
		elif command -v chromium-browser &>/dev/null; then
			browser="chromium-browser"
		elif command -v chromium &>/dev/null; then
			browser="chromium"
		fi
		if [ -n "$browser" ]; then
			install_package xdotool "xdotool" || true
			install_package xclip "xclip" || true
			if
				xdotool search --onlyvisible --name '.*- Node\.js[：:].*' &>/dev/null ||
					xdotool search --onlyvisible --name '^DevTools$' &>/dev/null;
			then
				return
			fi
			local original_clip
			original_clip=$(xclip -o -selection clipboard 2>/dev/null)
			echo -n "chrome://inspect" | xclip -selection clipboard
			"$browser" --new-window &
			sleep 2
			xdotool key ctrl+l
			xdotool key ctrl+v
			echo -n "$original_clip" | xclip -selection clipboard || true
			xdotool key Return
			sleep 0.3
			xdotool key --repeat 5 Tab
			xdotool key Return
		fi
	fi
}
