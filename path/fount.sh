#!/usr/bin/env bash

# fount脚本需要兼容mac的上古版本bash，尽量避免使用新版本语法

# --- 彩色输出定义 ---
C_RESET='\033[0m'
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[0;33m'
C_CYAN='\033[0;36m'

# --- i18n functions ---
# Get system locales
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
	locales+=("en-UK") # Fallback
	# deduplicate
	# shellcheck disable=SC2207
	locales=($(printf "%s\n" "${locales[@]}" | awk '!x[$0]++'))
	echo "${locales[@]}"
}

# Get available locales from src/locales/list.csv
get_available_locales() {
	local locale_list_file="$FOUNT_DIR/src/locales/list.csv"
	if [ -f "$locale_list_file" ]; then
		# Skip header and get the first column
		tail -n +2 "$locale_list_file" | cut -d, -f1
	else
		echo "en-UK" # Fallback
	fi
}

# Find the best locale to use
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

	echo "en-UK" # Default
}

# Load localization data
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
	local locale_file="$FOUNT_DIR/src/locales/$FOUNT_LOCALE.json"
	if [ ! -f "$locale_file" ]; then
		FOUNT_LOCALE="en-UK"
		export FOUNT_LOCALE
		locale_file="$FOUNT_DIR/src/locales/en-UK.json"
	fi
	# Check for jq
	if ! command -v jq &>/dev/null; then
		# If install_package exists, use it, otherwise, we can't do much
		if command -v install_package &>/dev/null; then
			install_package "jq" "jq"
		fi
	fi
	if command -v jq &>/dev/null; then
		cat "$locale_file"
	else
		echo "{}" # Return empty json if jq is not available
	fi
}

# Get a translated string
get_i18n() {
	local key="$1"
	if [ -z "$FOUNT_LOCALE_DATA" ]; then
		FOUNT_LOCALE_DATA=$(load_locale_data)
		export FOUNT_LOCALE_DATA
	fi
	local translation
	translation=$(echo "$FOUNT_LOCALE_DATA" | jq -r ".fountConsole.path.$key // .\"$key\" // \"$key\"")

	# Simple interpolation
	shift
	while [ $# -gt 0 ]; do
		local param_name="$1"
		local param_value="$2"
		# shellcheck disable=SC2001
		translation=$(echo "$translation" | sed "s/\\\${${param_name}}/${param_value}/g")
		shift 2
	done

	echo "$translation"
}

# 定义常量和路径
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
FOUNT_DIR=$(dirname "$SCRIPT_DIR")

# 若是 Windows 环境，则使用 fount.ps1
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
	powershell.exe -noprofile -executionpolicy bypass -file "$FOUNT_DIR\path\fount.ps1" "$@"
	exit $?
fi

# 转义后的fount路径用于sed
ESCAPED_FOUNT_DIR=$(echo "$FOUNT_DIR" | sed 's/\//\\\//g')

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

	echo "Default web browser is not detected, attempting to install..."
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
		echo -e "${C_RED}Error: Deno executable not found before patching. Cannot patch.${C_RESET}" >&2
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
		echo -e "${C_RED}Error: Unsupported architecture for patching: $arch${C_RESET}" >&2
		return 1
		;;
	esac

	if ! patchelf --set-rpath "${ORIGIN}/../glibc/lib" --set-interpreter "$interp_path" "$deno_bin"; then
		echo -e "${C_RED}Error: Failed to patch Deno executable with patchelf.${C_RESET}" >&2
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

update_fount_if_not_noupdate() {
	if [ -f "$FOUNT_DIR/.noupdate" ]; then
		get_i18n 'update.skippingFountUpdate'
	else
		fount_upgrade
	fi
}

upgrade_deno_if_not_docker() {
	if [ $IN_DOCKER -eq 1 ]; then
		get_i18n 'update.skippingDenoUpgradeDocker'
	else
		deno_upgrade
	fi
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

git_reset_and_clean() {
	if command -v git &>/dev/null; then
		git -C "$FOUNT_DIR" config core.autocrlf false
		git -C "$FOUNT_DIR" clean -fd
		git -C "$FOUNT_DIR" reset --hard "origin/master"
		git -C "$FOUNT_DIR" gc --aggressive --prune=now --force
	fi
}

handle_auto_reinitialization() {
	if [ -f "$FOUNT_DIR/.noautoinit" ]; then
		echo -e "${C_YELLOW}fount has restarted many times in the last short time, but auto-reinitialization is disabled by .noautoinit file. Exiting.${C_RESET}" >&2
		exit 1
	fi
	echo -e "${C_YELLOW}fount has restarted many times in the last short time. Forcing re-initialization...${C_RESET}" >&2
	restart_timestamps=()

	if ! ("$0" init); then
		echo -e "${C_RED}fount init failed. Exiting.${C_RESET}" >&2
		exit 1
	fi
	init_attempted=1
	echo "Re-initialization complete. Attempting to restart fount..."
}

get_profile_files() {
	printf "%s\\n" "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile"
}

# 函数: 创建桌面快捷方式
create_desktop_shortcut() {
	local icon_path="$FOUNT_DIR/src/pages/favicon.ico"

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
Exec=$FOUNT_DIR/path/fount open keepalive
Icon=$icon_path
Terminal=true
Categories=Utility;
EOF
		chmod +x "$desktop_file_path"
		echo -e "$(get_i18n 'shortcut.desktopShortcutCreated' 'path' "${C_CYAN}$desktop_file_path${C_RESET}")"

		local protocol_desktop_file_path="$HOME/.local/share/applications/fount-protocol.desktop"
		mkdir -p "$(dirname "$protocol_desktop_file_path")"
		cat <<EOF >"$protocol_desktop_file_path"
[Desktop Entry]
Version=1.0
Type=Application
Name=fount Protocol Handler
Comment=Handles fount:// protocol links
Exec=$FOUNT_DIR/path/fount protocolhandle %u
Terminal=false
NoDisplay=true
MimeType=x-scheme-handler/fount;
Categories=Utility;
EOF
		chmod +x "$protocol_desktop_file_path"
		xdg-mime default fount-protocol.desktop x-scheme-handler/fount
		if command -v update-desktop-database &>/dev/null; then
			update-desktop-database "$HOME/.local/share/applications"
		fi
		get_i18n 'shortcut.protocolHandlerRegistered'

	elif [ "$OS_TYPE" = "Darwin" ]; then
		local app_path="$HOME/Desktop/fount.app"
		rm -rf "$app_path" # Clean up old version first

		mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources"
		local icns_path="$FOUNT_DIR/src/pages/favicon.icns"
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
		set command_to_execute to command_to_execute & " open keepalive"
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
			echo -e "${C_RED}$(get_i18n 'shortcut.osacompileNotFound')${C_RESET}" >&2
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
				echo -e "${C_YELLOW}$(get_i18n 'shortcut.lsregisterFailed')${C_RESET}" >&2
				# 操你妈，跟你爆了
				killall lsd
			fi
		else
			# 操你妈，跟你爆了
			killall lsd
		fi

		if [ -d "$app_path" ]; then
			echo -e "$(get_i18n 'shortcut.desktopShortcutCreated' 'path' "${C_CYAN}$app_path${C_RESET}")"
		else
			echo -e "${C_RED}$(get_i18n 'shortcut.createDesktopAppFailed')${C_RESET}" >&2
			return 1
		fi
	else
		echo -e "${C_YELLOW}$(get_i18n 'shortcut.shortcutNotSupported' 'os' "$OS_TYPE")${C_RESET}"
	fi
	return 0
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
	handle_docker_termux_passthrough "$@"
	case "$1" in
	open)
		# 若 $FOUNT_DIR/data 是目录
		if [ -d "$FOUNT_DIR/data" ]; then
			ensure_dependencies "open" || exit 1
			TARGET_URL='https://steve02081504.github.io/fount/wait'
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
		exit 0
		;;
	protocolhandle)
		protocolUrl="$2"
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
		git -C "$FOUNT_DIR" init -b master
		git -C "$FOUNT_DIR" config core.autocrlf false
		git -C "$FOUNT_DIR" remote add origin https://github.com/steve02081504/fount.git
		get_i18n 'git.fetchingAndResetting'
		if ! git -C "$FOUNT_DIR" fetch origin master --depth 1; then
			echo -e "${C_RED}$(get_i18n 'git.fetchFailed')${C_RESET}"
			return 1
		fi
		local diff_output
		diff_output=$(git -C "$FOUNT_DIR" diff "origin/master")
		if [ -n "$diff_output" ]; then
			echo -e "${C_YELLOW}$(get_i18n 'git.localChangesDetected')${C_RESET}"
			local timestamp
			timestamp=$(date +'%Y%m%d_%H%M%S')
			local tmp_dir="${TMPDIR:-/tmp}"
			local diff_file_name="fount-local-changes-diff_$timestamp.diff"
			local diff_file_path="$tmp_dir/$diff_file_name"
			echo "$diff_output" >"$diff_file_path"
			echo -e "${C_GREEN}$(get_i18n 'git.backupSavedTo' 'path' "${C_CYAN}$diff_file_path${C_RESET}")"
		fi
		git_reset_and_clean
	else
		git -C "$FOUNT_DIR" config core.autocrlf false
		git -C "$FOUNT_DIR" fetch origin
		local currentBranch
		currentBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD)
		if [ "$currentBranch" = "HEAD" ]; then
			get_i18n 'git.notOnBranch'
			git_reset_and_clean
			git -C "$FOUNT_DIR" checkout master
			currentBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD)
		fi
		local remoteBranch
		remoteBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
		if [ -z "$remoteBranch" ]; then
			echo -e "${C_YELLOW}$(get_i18n 'git.noUpstreamBranch' 'branch' "$currentBranch")${C_RESET}" >&2
			git -C "$FOUNT_DIR" branch --set-upstream-to origin/master "$currentBranch"
			remoteBranch="origin/master"
		fi
		if [ -n "$(git -C "$FOUNT_DIR" status --porcelain)" ]; then
			echo -e "${C_YELLOW}$(get_i18n 'git.dirtyWorkingDirectory')${C_RESET}" >&2
		fi
		local mergeBase
		mergeBase=$(git -C "$FOUNT_DIR" merge-base "$currentBranch" "$remoteBranch")
		local localCommit
		localCommit=$(git -C "$FOUNT_DIR" rev-parse "$currentBranch")
		local remoteCommit
		remoteCommit=$(git -C "$FOUNT_DIR" rev-parse "$remoteBranch")
		if [ "$localCommit" != "$remoteCommit" ]; then
			if [ "$mergeBase" = "$localCommit" ]; then
				get_i18n 'git.updatingFromRemote'
				git -C "$FOUNT_DIR" reset --hard "$remoteBranch"
			elif [ "$mergeBase" = "$remoteCommit" ]; then
				get_i18n 'git.localBranchAhead'
			else
				get_i18n 'git.branchesDiverged'
				git -C "$FOUNT_DIR" reset --hard "$remoteBranch"
			fi
		else
			get_i18n 'git.alreadyUpToDate'
		fi
	fi
}

# 更新 fount
if [[ $# -eq 0 || $1 != "shutdown" ]]; then
	update_fount_if_not_noupdate
fi

# 函数: 安装 Deno
install_deno() {
	if command -v deno &>/dev/null && [[ $IN_TERMUX -eq 0 || -f ~/.deno/bin/deno.glibc.sh ]]; then return 0; fi
	if [[ -z "$(command -v deno)" && -f "$HOME/.deno/env" ]]; then
		# shellcheck source=/dev/null
		. "$HOME/.deno/env"
	fi
	if command -v deno &>/dev/null && [[ $IN_TERMUX -eq 0 || -f ~/.deno/bin/deno.glibc.sh ]]; then return 0; fi

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
				echo -e "${C_RED}$(get_i18n 'deno.isRequired')${C_RESET}" >&2
				exit 1
			fi
		fi
		# shellcheck source=/dev/null
		[ -f "$HOME/.deno/env" ] && . "$HOME/.deno/env"
		export PATH="$PATH:$HOME/.deno/bin"
		touch "$AUTO_INSTALLED_DENO_FLAG"
	fi
	if ! command -v deno &>/dev/null; then
		echo -e "${C_RED}$(get_i18n 'deno.isRequired')${C_RESET}" >&2
		exit 1
	fi
}
install_deno

# 函数: 升级 Deno
deno_upgrade() {
	local deno_version_before
	deno_version_before=$(run_deno -V 2>&1)
	if [[ -z "$deno_version_before" ]]; then
		echo -e "${C_RED}$(get_i18n 'deno.notWorking')${C_RESET}" >&2
		return
	fi

	local deno_upgrade_channel="stable"
	if [[ "$deno_version_before" == *"+"* ]]; then
		deno_upgrade_channel="canary"
	elif [[ "$deno_version_before" == *"-rc"* ]]; then
		deno_upgrade_channel="rc"
	fi

	if ! run_deno upgrade -q "$deno_upgrade_channel"; then
		if [[ $IN_TERMUX -eq 1 ]]; then
			get_i18n 'deno.upgradeFailedTermux'
			rm -rf "$HOME/.deno"
			install_deno
		else
			echo -e "${C_YELLOW}$(get_i18n 'deno.upgradeFailed')${C_RESET}" >&2
		fi
	fi
}

if [[ $# -eq 0 || ($1 != "shutdown" && $1 != "geneexe") ]]; then
	upgrade_deno_if_not_docker
	run_deno -V
fi
is_debug=0
debug_on() {
	is_debug=1
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
			original_clip=$(xclip -o -selection clipboard 2>/dev/null)
			echo -n "chrome://inspect" | xclip -selection clipboard
			"$browser" --new-window &
			sleep 2
			xdotool key ctrl+l
			xdotool key ctrl+v
			xdotool key Return
			echo -n "$original_clip" | xclip -selection clipboard
		fi
	fi
}
# 函数: 运行 fount
run() {
	if [[ $(id -u) -eq 0 ]]; then
		echo -e "${C_YELLOW}$(get_i18n 'install.rootWarning1')${C_RESET}" >&2
		echo -e "${C_YELLOW}$(get_i18n 'install.rootWarning2')${C_RESET}" >&2
	fi
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
	if [[ $is_debug -eq 1 ]]; then
		run_deno run --allow-scripts --allow-all --inspect-brk -c "$FOUNT_DIR/deno.json" --v8-flags=--expose-gc "$FOUNT_DIR/src/server/index.mjs" "$@"
	else
		run_deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --v8-flags=--expose-gc "$FOUNT_DIR/src/server/index.mjs" "$@"
	fi
	local exit_code=$?
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
	get_i18n 'install.installingDependencies'
	set +e # 禁用错误检测，因为第一次运行可能会失败
	run_deno install --reload --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --entrypoint "$FOUNT_DIR/src/server/index.mjs"
	run "shutdown" # 确保安装后服务能正常启动
	set -e         # 重新启用严格模式
	if [ $IN_DOCKER -eq 0 ] && [ $IN_TERMUX -eq 0 ]; then
		create_desktop_shortcut
	fi
	echo -e "${C_GREEN}======================================================${C_RESET}"
	echo -e "${C_YELLOW}$(get_i18n 'install.untrustedPartsWarning')${C_RESET}"
	echo -e "${C_GREEN}======================================================${C_RESET}"
fi

# 主要参数处理逻辑
case "$1" in
init)
	exit 0
	;;
clean)
	if [ -d "$FOUNT_DIR/node_modules" ]; then
		run shutdown
		get_i18n 'clean.removingCaches'
		rm -rf "$FOUNT_DIR/node_modules"
		find "$FOUNT_DIR" -name "*_cache.json" -type f -delete
	fi
	get_i18n 'clean.reinstallingDependencies'
	run shutdown
	get_i18n 'clean.cleaningDenoCaches'
	run_deno clean
	exit 0
	;;
keepalive)
	runargs=("${@:2}")
	if [[ "${runargs[0]}" == "debug" ]]; then
		debug_on
		runargs=("${runargs[@]:1}")
	fi

	start_time=$(date +%s)
	init_attempted=0
	restart_timestamps=()

	run "${runargs[@]}"
	exit_code=$?
	# shellcheck disable=SC2181
	while [ $exit_code -ne 0 ]; do
		if [ $exit_code -ne 131 ]; then
			current_time=$(date +%s)
			elapsed_time=$((current_time - start_time))
			if [ "$elapsed_time" -lt 180 ] && [ "$init_attempted" -eq 1 ]; then
				echo -e "${C_RED}$(get_i18n 'keepalive.failedToStart')${C_RESET}" >&2
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

		update_fount_if_not_noupdate
		upgrade_deno_if_not_docker
		run
		exit_code=$?
	done
	;;
remove)
	run shutdown
	run_deno clean
	get_i18n 'remove.removingFount'

	get_i18n 'remove.removingFountFromPath'
	while IFS= read -r profile_file; do
		if [ -f "$profile_file" ]; then
			# shellcheck disable=SC2016
			run_sed_inplace '/export PATH="\$PATH:'"$ESCAPED_FOUNT_DIR"'\/path"/d' "$profile_file"
		fi
	done < <(get_profile_files)
	PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$FOUNT_DIR/path" | tr '\n' ':' | sed 's/:*$//')
	export PATH

	get_i18n 'remove.removingProtocolHandler'
	remove_desktop_shortcut

	get_i18n 'remove.removingFountFromGitSafeDir'
	if command -v git &>/dev/null && git config --global --get-all safe.directory | grep -q -xF "$FOUNT_DIR"; then
		git config --global --unset safe.directory "$FOUNT_DIR"
	fi

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

	get_i18n 'remove.removingFountInstallationDir'
	rm -rf "$FOUNT_DIR"
	# 只要父目录为空，继续删他妈的
	parent_dir=$(dirname "$FOUNT_DIR")
	while rmdir "$parent_dir" 2>/dev/null; do
		parent_dir=$(dirname "$parent_dir")
	done
	get_i18n 'remove.fountInstallationDirRemoved'

	get_i18n 'remove.fountUninstallationComplete'
	exit 0
	;;
*)
	runargs=("${@}")
	if [[ "${runargs[0]}" == "debug" ]]; then
		debug_on
		runargs=("${runargs[@]:1}")
	fi
	run "${runargs[@]}"
	exit_code=$?
	while [ $exit_code -eq 131 ]; do
		if [ -f "$FOUNT_DIR/.noupdate" ]; then
			get_i18n 'update.skippingFountUpdate'
		else
			deno_upgrade
			fount_upgrade
		fi
		run
		exit_code=$?
	done
	exit $exit_code
	;;
esac
