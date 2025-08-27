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
OS_TYPE=$(uname -s)

# 确保在脚本退出时，状态服务器进程能被清理
cleanup() {
	if [[ -n "$STATUS_SERVER_PID" ]]; then
		kill "$STATUS_SERVER_PID" 2>/dev/null
		STATUS_SERVER_PID=""
	fi
}
trap cleanup EXIT

# 初始化自动安装的包列表
FOUNT_AUTO_INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"

# 辅助函数: 智能地使用包管理器进行安装
install_with_manager() {
	local manager_cmd="$1"
	local package_to_install="$2"
	local update_args=""
	local install_args=""
	local has_sudo=""

	if ! command -v "$manager_cmd" &>/dev/null; then return 1; fi
	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then has_sudo="sudo"; fi

	case "$manager_cmd" in
	"apt-get") update_args="update -y"; install_args="install -y" ;;
	"pacman") update_args="-Syy --noconfirm"; install_args="-S --needed --noconfirm" ;;
	"dnf") update_args="makecache"; install_args="install -y" ;;
	"yum") update_args="makecache fast"; install_args="install -y" ;;
	"zypper") update_args="refresh"; install_args="install -y --no-confirm" ;;
	"pkg") update_args="update -y"; install_args="install -y" ;;
	"apk") install_args="add --update" ;;
	"brew") has_sudo=""; install_args="install" ;;
	"snap") has_sudo="sudo"; install_args="install" ;;
	*) return 1 ;;
	esac

	if [[ -n "$update_args" ]]; then
		# shellcheck disable=SC2086
		$has_sudo "$manager_cmd" $update_args
	fi
	# shellcheck disable=SC2086
	$has_sudo "$manager_cmd" $install_args "$package_to_install"
}

# 函数: 安装包
install_package() {
	local command_name="$1"
	local package_list_str="${2:-$command_name}"
	# shellcheck disable=SC2206
	local package_list=($package_list_str)
	local installed_pkg_name=""

	if command -v "$command_name" &>/dev/null; then return 0; fi

	for package in "${package_list[@]}"; do
		if
			install_with_manager "pkg" "$package" ||
				install_with_manager "apt-get" "$package" ||
				install_with_manager "pacman" "$package" ||
				install_with_manager "dnf" "$package" ||
				install_with_manager "yum" "$package" ||
				install_with_manager "zypper" "$package" ||
				install_with_manager "apk" "$package" ||
				install_with_manager "brew" "$package" ||
				install_with_manager "snap" "$package"
		then
			if command -v "$command_name" &>/dev/null; then
				installed_pkg_name="$package"
				break
			fi
		fi
	done

	if command -v "$command_name" &>/dev/null; then
		if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then
			FOUNT_AUTO_INSTALLED_PACKAGES="$installed_pkg_name"
		else
			FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$installed_pkg_name"
		fi
		export FOUNT_AUTO_INSTALLED_PACKAGES
		return 0
	else
		echo -e "${C_RED}Error: $command_name installation failed.${C_RESET}" >&2
		return 1
	fi
}

test_browser() {
	local browser_detected=0

	if [ "$OS_TYPE" = "Linux" ]; then
		install_package "xdg-settings" "xdg-utils"
		if command -v xdg-settings &>/dev/null; then
			local default_browser_desktop
			default_browser_desktop=$(xdg-settings get default-web-browser 2>/dev/null)
			if [[ -n "$default_browser_desktop" && "$default_browser_desktop" == *".desktop"* ]]; then
				browser_detected=1
			fi
		fi
	elif [ "$OS_TYPE" = "Darwin" ]; then
		local default_browser_bundle_id
		default_browser_bundle_id=$(defaults read ~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist 2>/dev/null | grep -B 1 "LSHandlerURLScheme = https;" | sed -n -e 's/^.*RoleAll = "//' -e 's/";//p' | head -n 1) || true
		if [ -n "$default_browser_bundle_id" ]; then
			browser_detected=1
		fi
	fi

	if [ $browser_detected -eq 0 ]; then
		echo "Default web browser is not detected, attempting to install..."
		install_package "google-chrome" "google-chrome google-chrome-stable"
	fi
	return 0
}

# 默认安装目录
FOUNT_DIR="${FOUNT_DIR:-"$HOME/.local/share/fount"}"

new_args=("$@")
if [[ "${#new_args[@]}" -eq 0 ]]; then
	new_args=("open" "keepalive")
fi

if command -v fount.sh &>/dev/null; then
	# 从现有命令推断出安装目录
	FOUNT_DIR="$(dirname "$(dirname "$(command -v fount.sh)")")"
else
	# 检测环境
	IN_DOCKER=0
	if [ -f "/.dockerenv" ] || grep -q 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
		IN_DOCKER=1
	fi
	IN_TERMUX=0
	if [[ -d "/data/data/com.termux" ]]; then
		IN_TERMUX=1
	fi

	if [[ $IN_DOCKER -eq 0 && $IN_TERMUX -eq 0 && "${new_args[*]}" == *'open'* ]]; then
		install_package "nc" "netcat gnu-netcat openbsd-netcat netcat-openbsd nmap-ncat" || install_package "socat" "socat"

		if command -v nc &>/dev/null; then
			while true; do {
				while IFS= read -r -t 2 line && [[ "$line" != $'\r' ]]; do :; done
				echo -e "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"message\":\"installing\"}"
			} | nc -l 8930 -q 0; done >/dev/null 2>&1 &
			STATUS_SERVER_PID=$!
		elif command -v socat &>/dev/null; then
			(socat -T 5 TCP-LISTEN:8930,reuseaddr,fork SYSTEM:"read; echo -e 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"message\":\"installing\"}'") >/dev/null 2>&1 &
			STATUS_SERVER_PID=$!
		fi

		if [[ -n "$STATUS_SERVER_PID" ]]; then
			test_browser
			URL='https://steve02081504.github.io/fount/wait/install'
			if [[ "$(uname -s)" == "Linux" ]]; then
				(xdg-open "$URL" &)
			elif [[ "$(uname -s)" == "Darwin" ]]; then
				(open "$URL" &)
			fi
			temp_args=()
			for arg in "${new_args[@]}"; do
				[[ "$arg" != "open" ]] && temp_args+=("$arg")
			done
			new_args=("${temp_args[@]}")
		else
			echo -e "${C_YELLOW}Warning: Could not start status server. Proceeding with standard installation.${C_RESET}"
		fi
	fi

	echo -e "Installing fount into ${C_CYAN}$FOUNT_DIR${C_RESET}..."
	rm -rf "$FOUNT_DIR"
	mkdir -p "$(dirname "$FOUNT_DIR")"

	if install_package "git" "git git-core"; then
		echo "Cloning fount repository..."
		if git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR" --depth 1 --single-branch --branch "$FOUNT_BRANCH"; then
			echo -e "${C_GREEN}Clone successful.${C_RESET}"
		else
			echo -e "${C_YELLOW}Git clone failed, falling back to zip download...${C_RESET}"
			rm -rf "$FOUNT_DIR"
		fi
	fi

	if [ ! -f "$FOUNT_DIR/path/fount.sh" ]; then
		install_package "curl" "curl" || install_package "wget" "wget" || exit 1
		install_package "unzip" "unzip" || exit 1

		TMP_DIR=$(mktemp -d)
		trap 'rm -rf "$TMP_DIR"' EXIT

		ZIP_URL="https://github.com/steve02081504/fount/archive/refs/heads/$FOUNT_BRANCH.zip"
		ZIP_FILE="$TMP_DIR/fount.zip"

		echo "Downloading fount from $ZIP_URL..."
		if command -v curl &>/dev/null; then
			curl --progress-bar -L -o "$ZIP_FILE" "$ZIP_URL"
		else
			wget -q --show-progress -O "$ZIP_FILE" "$ZIP_URL"
		fi

		# shellcheck disable=SC2181
		if [ $? -ne 0 ]; then
			echo -e "${C_RED}Error: Download failed.${C_RESET}" >&2
			exit 1
		fi

		echo "Unzipping fount..."
		if ! unzip -q -o "$ZIP_FILE" -d "$TMP_DIR"; then
			echo -e "${C_RED}Error: Unzip failed.${C_RESET}" >&2
			exit 1
		fi

		extracted_dir=$(find "$TMP_DIR" -maxdepth 1 -type d -name "fount-*" | head -n 1)

		if [ -z "$extracted_dir" ] || [ ! -d "$extracted_dir" ]; then
			echo -e "${C_RED}Error: Could not find extracted fount directory in $TMP_DIR${C_RESET}" >&2
			exit 1
		fi

		mkdir -p "$FOUNT_DIR"
		mv "$extracted_dir"/* "$FOUNT_DIR"
	fi

	if [ ! -f "$FOUNT_DIR/path/fount.sh" ]; then
		echo -e "${C_RED}Error: fount installation failed. Main script not found.${C_RESET}" >&2
		exit 1
	fi

	echo "Setting permissions..."
	if [[ "$OSTYPE" == "darwin"* ]]; then
		xattr -dr com.apple.quarantine "$FOUNT_DIR" 2>/dev/null || true
	fi
	find "$FOUNT_DIR" -name "*.sh" -exec chmod +x {} +
	find "$FOUNT_DIR/path" -type f -exec chmod +x {} +
	chmod -x "$FOUNT_DIR/path/desktop.ini" 2>/dev/null || true

	echo -e "${C_GREEN}fount installation complete.${C_RESET}"

	if [[ -n "$STATUS_SERVER_PID" ]]; then
		kill "$STATUS_SERVER_PID" 2>/dev/null
		STATUS_SERVER_PID=""
	fi
fi

# 若脚本自身内容和$FOUNT_DIR/src/runner/main.sh的内容不同，则更新自身
if [[ "$0" == */* ]] && [ -w "$0" ] && ! cmp -s "$FOUNT_DIR/src/runner/main.sh" "$0"; then
	cp "$FOUNT_DIR/src/runner/main.sh" "$0"
	chmod +x "$0"
fi

# 执行真正的 fount 核心脚本
"$FOUNT_DIR/run.sh" "${new_args[@]}"
