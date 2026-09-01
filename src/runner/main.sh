#!/usr/bin/env bash

# fount脚本需要兼容mac的上古版本bash，尽量避免使用新版本语法

# --- 彩色输出定义 ---
C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_CYAN='\033[0;36m'

# 若未定义，则默认 fount 安装分支
FOUNT_BRANCH="${FOUNT_BRANCH:-"master"}"

# 任务栏进度
taskbar_progress_enabled() { [ -t 1 ]; }
write_taskbar_progress() {
	taskbar_progress_enabled || return 0
	if [ -n "${1:-}" ]; then
		printf "\033]9;4;1;%s\007" "$1"
	else
		printf "\033]9;4;3\007"
	fi
}
# shellcheck disable=SC2329 # cleanup中有调用
write_taskbar_progress_clear() { taskbar_progress_enabled && printf "\033]9;4;0\007" || true; }
write_taskbar_progress_error() { taskbar_progress_enabled && printf "\033]9;4;2;100\007" || true; }

write_taskbar_progress 0

# 安装目标保护：不替换可能正被进程用作 cwd 的目录，所有 bash 平台统一走暂存安装。
FOUNT_EXISTING_INSTALL=0
if [ -z "${FOUNT_DIR:-}" ]; then
	if command -v fount.sh &>/dev/null; then
		FOUNT_DIR="$(dirname "$(dirname "$(command -v fount.sh)")")"
	else
		FOUNT_DIR="$HOME/.local/share/fount"
	fi
fi

test_fount_tree() {
	[ -f "$1/run.sh" ] && [ -f "$1/path/fount.sh" ] &&
		[ -f "$1/path/src/i18n.sh" ] && [ -f "$1/path/src/eula.sh" ]
}

test_fount_target_empty() {
	local entry="$1"
	if [ ! -d "$1" ]; then
		[ ! -e "$1" ] && [ ! -L "$1" ] || return 1
		while [ ! -e "$entry" ] && [ ! -L "$entry" ]; do entry=$(dirname "$entry"); done
		[ -d "$entry" ]
		return $?
	fi
	[ -r "$1" ] && [ -x "$1" ] || return 1
	for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do
		if [ -e "$entry" ] || [ -L "$entry" ]; then return 1; fi
	done
	return 0
}

if test_fount_tree "$FOUNT_DIR"; then
	FOUNT_EXISTING_INSTALL=1
elif ! test_fount_target_empty "$FOUNT_DIR"; then
	echo "Error: $FOUNT_DIR is not an empty directory or a fount installation. Choose another FOUNT_DIR; existing files were left untouched." >&2
	exit 1
fi

if echo "${LANG:-}" | grep -iqE "_(CN|KP|RU)"; then
(
	TARGETS="github.com cdn.jsdelivr.net"
	# 随手之劳之经验医学之clash的tun没开
	for host in $TARGETS; do
		if ! ping -c 1 -W 2 "$host" >/dev/null 2>&1; then
			curl -X PATCH "http://127.0.0.1:9090/configs" \
				-d '{"tun":{"enable":true}}' \
				-s -o /dev/null --max-time 3
			curl -X PATCH "http://127.0.0.1:9097/configs" \
				-d '{"tun":{"enable":true}}' \
				-s -o /dev/null --max-time 3
			break
		fi
	done
) >/dev/null 2>&1 &
fi

# 若是 Windows 环境，则转交 PowerShell 处理
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
	powershell.exe -noprofile -executionpolicy bypass -command "& {
	\$scriptContent = Invoke-RestMethod https://raw.githubusercontent.com/steve02081504/fount/refs/heads/$FOUNT_BRANCH/src/runner/main.ps1
	Invoke-Expression \"function fountInstaller { \$scriptContent }\"
	fountInstaller \$args
	}" -- "$@"
	exit $?
fi

STATUS_SERVER_PID=""
EULA_DECLINED=0
OS_TYPE=$(uname -s)
IN_TERMUX=0
if [[ -d "/data/data/com.termux" ]]; then
	IN_TERMUX=1
fi

# 确保在脚本退出时，状态服务器进程能被清理，并清除任务栏进度
# shellcheck disable=SC2329 # trap中有调用
cleanup() {
	if [[ -n "${STATUS_SERVER_PID:-}" ]]; then
		stop_fount_status_server
	fi
	if [[ "${EULA_DECLINED:-0}" -eq 1 ]] && type uninstall_auto_packages &>/dev/null; then
		uninstall_auto_packages
	fi
	[ -n "${FOUNT_INSTALL_TMP:-}" ] && rm -rf "$FOUNT_INSTALL_TMP"
	write_taskbar_progress_clear
}
trap cleanup EXIT

# 初始化自动安装的包列表
FOUNT_AUTO_INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"

# --- 包管理：main.sh 是 bash 脚本，用 bash 版（与 path/fount 的 POSIX 版行为一致，但不作同步） ---
FOUNT_PKG_STATE_DIR="${FOUNT_PKG_STATE_DIR:-${TMPDIR:-${TEMP:-/tmp}}/fount/package}"

pkg_lock_acquire() {
	local _manager="$1" _pkg_lock_dir="$FOUNT_PKG_STATE_DIR/$1.lock" _pid="" _retry_count=0
	mkdir -p "$FOUNT_PKG_STATE_DIR" 2>/dev/null || return 1
	while ! mkdir "$_pkg_lock_dir" 2>/dev/null; do
		if [[ -f "$_pkg_lock_dir/pid" ]]; then
			_pid=$(cat "$_pkg_lock_dir/pid" 2>/dev/null)
			if [[ -n "$_pid" ]] && ! kill -0 "$_pid" 2>/dev/null; then
				rm -rf "$_pkg_lock_dir"
				continue
			fi
		fi
		_retry_count=$((_retry_count + 1))
		[[ "$_retry_count" -ge $(( ${FOUNT_PKG_LOCK_TIMEOUT:-300} * 10 )) ]] && return 1
		sleep 0.1 2>/dev/null || sleep 1
	done
	printf '%s\n' "$$" >"$_pkg_lock_dir/pid"
	FOUNT_PKG_LOCK_DIR="$_pkg_lock_dir"
	return 0
}

pkg_lock_release() {
	[[ -n "$FOUNT_PKG_LOCK_DIR" ]] || return 0
	rm -rf "$FOUNT_PKG_LOCK_DIR"
	FOUNT_PKG_LOCK_DIR=""
}

pkg_with_lock() {
	local _manager="$1"
	shift
	pkg_lock_acquire "$_manager" || return 1
	"$@"
	local _exit_status=$?
	pkg_lock_release
	return $_exit_status
}

pkg_db_refresh_needed() {
	local _manager="$1" _refresh_file="$FOUNT_PKG_STATE_DIR/$1.refresh" _now="" _last=""
	[[ -f "$_refresh_file" ]] || return 0
	_now=$(date +%s 2>/dev/null) || return 0
	_last=$(cat "$_refresh_file" 2>/dev/null)
	[[ -n "$_last" ]] || return 0
	[[ "$((_now - _last))" -ge "${FOUNT_PKG_REFRESH_INTERVAL:-600}" ]]
}

pkg_db_refresh_mark() {
	local _manager="$1"
	mkdir -p "$FOUNT_PKG_STATE_DIR" 2>/dev/null || return 1
	printf '%s\n' "$(date +%s 2>/dev/null)" >"$FOUNT_PKG_STATE_DIR/$_manager.refresh" 2>/dev/null
}

pkg_refresh() {
	local _manager="$1"
	shift
	pkg_db_refresh_needed "$_manager" || return 0
	pkg_lock_acquire "$_manager" || return 1
	if pkg_db_refresh_needed "$_manager"; then
		if "$@"; then
			pkg_db_refresh_mark "$_manager"
			local _exit_status=0
		else
			local _exit_status=$?
		fi
		pkg_lock_release
		return $_exit_status
	fi
	pkg_lock_release
	return 0
}

install_package() {
	local command_name="$1"
	# shellcheck disable=SC2206 # 包列表需要按空格分词
	local -a package_list=(${2:-$command_name})
	local has_sudo="" installed_pkg_name="" package

	if command -v "$command_name" &>/dev/null; then return 0; fi

	if [[ "$(id -u)" -ne 0 ]] && command -v sudo &>/dev/null; then has_sudo="sudo"; fi

	for package in "${package_list[@]}"; do
		if command -v apt-get &>/dev/null; then
			pkg_refresh apt-get $has_sudo apt-get update -y
			pkg_with_lock apt-get $has_sudo apt-get install -y "$package"
			if command -v "$command_name" &>/dev/null; then installed_pkg_name="$package"; break; fi
		fi
		if command -v pacman &>/dev/null; then
			pkg_with_lock pacman $has_sudo pacman -Syu --needed --noconfirm "$package"
			if command -v "$command_name" &>/dev/null; then installed_pkg_name="$package"; break; fi
		fi
		if command -v dnf &>/dev/null; then
			pkg_refresh dnf $has_sudo dnf makecache
			pkg_with_lock dnf $has_sudo dnf install -y "$package"
			if command -v "$command_name" &>/dev/null; then installed_pkg_name="$package"; break; fi
		fi
		if command -v yum &>/dev/null; then
			pkg_refresh yum $has_sudo yum makecache fast
			pkg_with_lock yum $has_sudo yum install -y "$package"
			if command -v "$command_name" &>/dev/null; then installed_pkg_name="$package"; break; fi
		fi
		if command -v zypper &>/dev/null; then
			pkg_refresh zypper $has_sudo zypper refresh
			pkg_with_lock zypper $has_sudo zypper install -y --no-confirm "$package"
			if command -v "$command_name" &>/dev/null; then installed_pkg_name="$package"; break; fi
		fi
		if command -v apk &>/dev/null; then
			if [[ "$(id -u)" -eq 0 ]]; then
				pkg_with_lock apk apk add --update "$package"
			else
				pkg_with_lock apk $has_sudo apk add --update "$package"
			fi
			if command -v "$command_name" &>/dev/null; then installed_pkg_name="$package"; break; fi
		fi
		if command -v brew &>/dev/null; then
			if ! brew list --formula "$package" &>/dev/null; then
				pkg_with_lock brew brew install "$package"
			fi
			if command -v "$command_name" &>/dev/null; then installed_pkg_name="$package"; break; fi
		fi
		if command -v pkg &>/dev/null; then
			pkg_refresh pkg $has_sudo pkg update -y
			pkg_with_lock pkg $has_sudo pkg install -y "$package"
			if command -v "$command_name" &>/dev/null; then installed_pkg_name="$package"; break; fi
		fi
		if command -v snap &>/dev/null; then
			pkg_with_lock snap $has_sudo snap install "$package"
			if command -v "$command_name" &>/dev/null; then installed_pkg_name="$package"; break; fi
		fi
	done

	if command -v "$command_name" &>/dev/null; then
		if [[ ";$FOUNT_AUTO_INSTALLED_PACKAGES;" != *";$installed_pkg_name;"* ]]; then
			FOUNT_AUTO_INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:+$FOUNT_AUTO_INSTALLED_PACKAGES;}$installed_pkg_name"
		fi
		export FOUNT_AUTO_INSTALLED_PACKAGES
		return 0
	else
		echo -e "${C_RED}Error: $command_name installation failed.${C_RESET}" >&2
		return 1
	fi
}

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
		# 尝试使用 defaults read
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

# shellcheck disable=SC2329 # cleanup中有调用
uninstall_auto_packages() {
	local package has_sudo=""
	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then has_sudo="sudo"; fi
	IFS=';' read -r -a pkgs <<< "${FOUNT_AUTO_INSTALLED_PACKAGES:-}"
	for package in "${pkgs[@]}"; do
		[ -z "$package" ] && continue
		if command -v apt-get &>/dev/null; then $has_sudo apt-get purge -y "$package" >/dev/null 2>&1 && continue; fi
		if command -v pacman &>/dev/null; then $has_sudo pacman -Rns --noconfirm "$package" >/dev/null 2>&1 && continue; fi
		if command -v dnf &>/dev/null; then $has_sudo dnf remove -y "$package" >/dev/null 2>&1 && continue; fi
		if command -v yum &>/dev/null; then $has_sudo yum remove -y "$package" >/dev/null 2>&1 && continue; fi
		if command -v zypper &>/dev/null; then $has_sudo zypper remove -y --no-confirm "$package" >/dev/null 2>&1 && continue; fi
		if command -v apk &>/dev/null; then $has_sudo apk del "$package" >/dev/null 2>&1 && continue; fi
		if command -v brew &>/dev/null; then brew uninstall "$package" >/dev/null 2>&1 && continue; fi
		if command -v snap &>/dev/null; then $has_sudo snap remove "$package" >/dev/null 2>&1 && continue; fi
		if command -v pkg &>/dev/null; then pkg uninstall -y "$package" >/dev/null 2>&1 && continue; fi
	done
}

open_install_wait_page() {
	local URL="$FOUNT_INSTALL_WAIT_URL"
	if [[ $IN_TERMUX -eq 1 ]]; then
		termux-open-url "$URL" >/dev/null 2>&1 &
	elif [[ "$OS_TYPE" == "Linux" ]]; then
		install_package "xdg-open" "xdg-utils"
		xdg-open "$URL" >/dev/null 2>&1 &
	elif [[ "$OS_TYPE" == "Darwin" ]]; then
		open "$URL" >/dev/null 2>&1 &
	fi
}

# 默认安装目录
FOUNT_DIR="${FOUNT_DIR:-"$HOME/.local/share/fount"}"

import_fount_locale() {
	FOUNT_CONSOLE_ANSI=0
	[ -t 1 ] && FOUNT_CONSOLE_ANSI=1
	export FOUNT_CONSOLE_ANSI FOUNT_DIR
	# shellcheck disable=SC1091
	. "$FOUNT_DIR/path/src/i18n.sh"
	# shellcheck disable=SC1091
	. "$FOUNT_DIR/path/src/eula.sh"
}

accept_eula=0
case "${FOUNT_ACCEPT_EULA:-}" in
1 | true | TRUE | yes | YES) accept_eula=1 ;;
esac
new_args=("$@")
if [[ "${#new_args[@]}" -eq 0 ]]; then
	new_args=("open" "keepalive")
fi

remove_fount_after_eula_decline() {
	if [ -f "$FOUNT_DIR/path/fount.sh" ]; then
		"$FOUNT_DIR/path/fount.sh" remove
	else
		rm -rf "$FOUNT_DIR"
	fi
}

install_fount_tree() {
	local clone_ok="" clones=() install_dir="$FOUNT_DIR"
	local locale_var="${LC_ALL:-${LC_MESSAGES:-$LANG}}"
	echo -e "Installing fount into ${C_CYAN}$FOUNT_DIR${C_RESET}..."
	FOUNT_INSTALL_TMP=$(mktemp -d) || return 1
	install_dir="$FOUNT_INSTALL_TMP/tree"
	mkdir -p "$(dirname "$FOUNT_DIR")"
	write_taskbar_progress 20

	if command -v git &>/dev/null; then
		write_taskbar_progress 25
		echo "Cloning fount repository..."
		clones+=("https://github.com/steve02081504/fount.git")
		if [[ "$locale_var" =~ _(CN|KP|RU)(\.|@|$) ]]; then
			clones+=("https://gh-proxy.org/github.com/steve02081504/fount.git" "https://gitclone.com/github.com/steve02081504/fount.git")
		fi
		for clone_url in "${clones[@]}"; do
			if git clone -c core.autocrlf=false -c http.lowSpeedLimit=1 -c http.lowSpeedTime=30 "$clone_url" "$install_dir" --depth 1 --single-branch --branch "$FOUNT_BRANCH"; then
				clone_ok=1
				break
			fi
			rm -rf "$install_dir"
		done
		if [ -n "$clone_ok" ]; then
			echo -e "${C_GREEN}Clone successful.${C_RESET}"
			write_taskbar_progress 40
		else
			echo -e "${C_YELLOW}Git clone failed, falling back to zip download...${C_RESET}"
			write_taskbar_progress 25
		fi
	fi

	if [ ! -f "$install_dir/path/fount.sh" ]; then
		write_taskbar_progress 25
		install_package "curl" "curl" || install_package "wget" "wget" || return 1
		write_taskbar_progress 30
		install_package "unzip" "unzip" || return 1
		write_taskbar_progress 35

		zip_urls=("https://github.com/steve02081504/fount/archive/refs/heads/$FOUNT_BRANCH.zip")
		if [[ "$locale_var" =~ _(CN|KP|RU)(\.|@|$) ]]; then
			zip_urls+=("https://gh-proxy.org/https://github.com/steve02081504/fount/archive/refs/heads/$FOUNT_BRANCH.zip")
		fi
		ZIP_FILE="$FOUNT_INSTALL_TMP/fount.zip"

		zip_ok=""
		for zip_url in "${zip_urls[@]}"; do
			echo "Downloading fount from $zip_url..."
			if command -v curl &>/dev/null; then
				curl --progress-bar -L -o "$ZIP_FILE" "$zip_url"
			else
				wget -q --show-progress -O "$ZIP_FILE" "$zip_url"
			fi
			# shellcheck disable=SC2181
			if [ $? -eq 0 ]; then
				zip_ok=1
				break
			fi
			rm -f "$ZIP_FILE"
		done
		write_taskbar_progress 40

		if [ -z "$zip_ok" ]; then
			echo -e "${C_RED}Error: Download failed.${C_RESET}" >&2
			rm -rf "$FOUNT_INSTALL_TMP"
			FOUNT_INSTALL_TMP=""
			return 1
		fi

		echo "Unzipping fount..."
		if ! unzip -q -o "$ZIP_FILE" -d "$FOUNT_INSTALL_TMP"; then
			echo -e "${C_RED}Error: Unzip failed.${C_RESET}" >&2
			rm -rf "$FOUNT_INSTALL_TMP"
			FOUNT_INSTALL_TMP=""
			return 1
		fi
		write_taskbar_progress 50

		extracted_dir=$(find "$FOUNT_INSTALL_TMP" -maxdepth 1 -type d -name "fount-*" | head -n 1)

		if [ -z "$extracted_dir" ] || [ ! -d "$extracted_dir" ]; then
			echo -e "${C_RED}Error: Could not find extracted fount directory in $FOUNT_INSTALL_TMP${C_RESET}" >&2
			rm -rf "$FOUNT_INSTALL_TMP"
			FOUNT_INSTALL_TMP=""
			return 1
		fi

		install_dir="$extracted_dir"
	fi

	if test_fount_tree "$install_dir" && test_fount_target_empty "$FOUNT_DIR"; then
		mkdir -p "$FOUNT_DIR" && cp -R "$install_dir/." "$FOUNT_DIR/" || {
			rm -rf "$FOUNT_INSTALL_TMP"
			FOUNT_INSTALL_TMP=""
			return 1
		}
	else
		rm -rf "$FOUNT_INSTALL_TMP"
		FOUNT_INSTALL_TMP=""
		return 1
	fi
	rm -rf "$FOUNT_INSTALL_TMP"
	FOUNT_INSTALL_TMP=""

	if [ ! -f "$FOUNT_DIR/path/fount.sh" ]; then
		write_taskbar_progress_error
		echo -e "${C_RED}Error: fount installation failed. Main script not found.${C_RESET}" >&2
		return 1
	fi

	write_taskbar_progress 60
	echo "Setting permissions..."
	if [[ "$OSTYPE" == "darwin"* ]]; then
		xattr -dr com.apple.quarantine "$FOUNT_DIR" 2>/dev/null || true
	fi
	find "$FOUNT_DIR" -type f \( -name "*.sh" -o -name "*.ps1" -o -name "*.fish" -o -name "*.zsh" -o -name "*.bat" \) -exec chmod +x {} +
	find "$FOUNT_DIR/path" -maxdepth 1 -type f ! -name 'desktop.ini' ! -iname 'agents.md' -exec chmod +x {} +
	[ -f "$FOUNT_DIR/path/desktop.ini" ] && chmod -x "$FOUNT_DIR/path/desktop.ini"
	for agentsManifestPath in "$FOUNT_DIR/path/AGENTS.md" "$FOUNT_DIR/path/agents.md"; do
		[ -f "$agentsManifestPath" ] && chmod -x "$agentsManifestPath"
	done
	[ -f "$FOUNT_DIR/gradlew" ] && chmod +x "$FOUNT_DIR/gradlew"
	[ -f "$FOUNT_DIR/gradlew.bat" ] && chmod +x "$FOUNT_DIR/gradlew.bat"
	write_taskbar_progress 70
	echo -e "${C_GREEN}fount installation complete.${C_RESET}"
	return 0
}

SCRIPT_SELF_PATH=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
	SCRIPT_SELF_PATH="${BASH_SOURCE[0]}"
elif [[ "$0" == */* && -f "$0" ]]; then
	SCRIPT_SELF_PATH="$0"
fi

can_self_modify=0
if [[ -n "$SCRIPT_SELF_PATH" && -w "$SCRIPT_SELF_PATH" ]]; then
	case "$SCRIPT_SELF_PATH" in
	/dev/fd/* | /proc/self/fd/* | /dev/stdin | -) ;;
	*) can_self_modify=1 ;;
	esac
fi

if [ "$FOUNT_EXISTING_INSTALL" -eq 1 ]; then
	import_fount_locale
else
	# 检测环境
	IN_DOCKER=0
	if [ -f "/.dockerenv" ] || grep -q 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
		IN_DOCKER=1
	fi

	install_package "git" "git git-core" || true
	if ! command -v git &>/dev/null; then
		install_package "curl" "curl" || install_package "wget" "wget" || exit 1
		install_package "unzip" "unzip" || exit 1
	fi

	install_fount_tree
	install_status=$?
	if [[ "$install_status" -ne 0 ]] || [ ! -f "$FOUNT_DIR/path/fount.sh" ]; then
		write_taskbar_progress_error
		echo -e "${C_RED}Error: fount installation failed. Main script not found.${C_RESET}" >&2
		exit 1
	fi

	import_fount_locale

	if [[ $IN_DOCKER -eq 0 && "$accept_eula" -eq 0 ]]; then
		if [[ ! -r /dev/tty ]]; then
			print_i18n_red 'eula.required' >&2
			echo "$FOUNT_EULA_URL" >&2
			remove_fount_after_eula_decline
			exit 1
		fi
		install_package "nc" "netcat gnu-netcat openbsd-netcat netcat-openbsd nmap-ncat" || install_package "socat" "socat"
		write_taskbar_progress 5
		start_fount_status_server
		write_taskbar_progress 10
		if [[ -z "${STATUS_SERVER_PID:-}" ]]; then
			print_i18n_yellow 'eula.statusServerFailed'
		fi
		test_browser
		begin_fount_install_wait
		open_install_wait_page
		if ! confirm_fount_eula; then
			get_i18n 'eula.declined'
			EULA_DECLINED=1
			remove_fount_after_eula_decline
			exit 1
		fi
	fi

	copy_fount_default_config
fi

# 若脚本自身内容和$FOUNT_DIR/src/runner/main.sh的内容不同，则更新自身
if [[ "$can_self_modify" -eq 1 && -f "$FOUNT_DIR/src/runner/main.sh" ]] && ! cmp -s "$FOUNT_DIR/src/runner/main.sh" "$SCRIPT_SELF_PATH"; then
	get_i18n 'install.runnerUpdating'
	cp "$FOUNT_DIR/src/runner/main.sh" "$SCRIPT_SELF_PATH"
	chmod +x "$SCRIPT_SELF_PATH"
fi

# 执行真正的 fount 核心脚本
"$FOUNT_DIR/run.sh" "${new_args[@]}"
fountExitCode=$?

if [[ "$can_self_modify" -eq 1 && "${new_args[0]}" == "remove" ]]; then
	rm -f "$SCRIPT_SELF_PATH"
fi

exit $fountExitCode
