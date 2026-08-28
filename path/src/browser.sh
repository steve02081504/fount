#!/usr/bin/env bash
# Browser detection, installation, and URL opening

test_browser() {
	if [[ $IN_TERMUX -eq 1 ]]; then
		return 0
	fi
	local run_as_user=""
	local user_home=$HOME

	if [ "$(id -u)" -eq 0 ] && [ -n "$SUDO_USER" ]; then
		user_home=$(eval echo "~$SUDO_USER")
		run_as_user="env HOME=$user_home sudo -u $SUDO_USER"
	fi

	if [ "$OS_TYPE" = "Linux" ]; then
		if command -v update-alternatives &>/dev/null; then
			local system_browser
			system_browser=$(update-alternatives --query x-www-browser | grep -o '/.*' | head -n1)
			if [ -n "$system_browser" ]; then
				return 1
			fi
		fi
		install_package "xdg-settings" "xdg-utils"
		if command -v xdg-settings &>/dev/null; then
			local default_browser_desktop
			default_browser_desktop=$($run_as_user xdg-settings get default-web-browser 2>/dev/null)
			if [[ -n "$default_browser_desktop" && "$default_browser_desktop" == *".desktop"* ]]; then
				return 1
			fi
		fi
	elif [ "$OS_TYPE" = "Darwin" ]; then
		local default_browser_bundle_id
		default_browser_bundle_id=$($run_as_user defaults read "${user_home}"/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist 2>/dev/null | grep -B 1 "LSHandlerURLScheme = https;" | sed -n -e 's/^.*RoleAll = "//' -e 's/";//p' | head -n 1) || true
		if [ -n "$default_browser_bundle_id" ]; then
			return 1
		fi
	fi

	# 已安装浏览器探测：默认关联未登记时也不误装。
	for browser_command in "google-chrome" "google-chrome-stable" "chromium" "chromium-browser" "microsoft-edge" "microsoft-edge-stable" "brave-browser" "firefox"; do
		if command -v "$browser_command" &>/dev/null; then
			return 1
		fi
	done
	if [ "$OS_TYPE" = "Linux" ]; then
		for browser_path in "/usr/bin/firefox" "/usr/bin/chromium" "/usr/bin/chromium-browser" "/usr/bin/google-chrome" "/usr/bin/microsoft-edge"; do
			if [ -x "$browser_path" ]; then
				return 1
			fi
		done
	elif [ "$OS_TYPE" = "Darwin" ]; then
		for browser_application in "/Applications/Google Chrome.app" "/Applications/Microsoft Edge.app" "/Applications/Firefox.app" "/Applications/Brave Browser.app" "/Applications/Chromium.app"; do
			if [ -d "$browser_application" ]; then
				return 1
			fi
		done
	fi

	get_i18n 'install.browserMissing'
	install_package "google-chrome" "google-chrome google-chrome-stable"
	if ! command -v google-chrome &>/dev/null; then
		install_package "chromium-browser" "chromium-browser chromium"
	fi
	return 0
}

open_url_in_browser() {
	local url="$1"
	test_browser
	if [[ $IN_TERMUX -eq 1 ]]; then
		termux-open-url "$url" >/dev/null 2>&1 &
	elif [ "$OS_TYPE" = "Linux" ]; then
		install_package "xdg-open" "xdg-utils" || return 1
		xdg-open "$url" >/dev/null 2>&1 &
	elif [ "$OS_TYPE" = "Darwin" ]; then
		open "$url" >/dev/null 2>&1 &
	fi
}
