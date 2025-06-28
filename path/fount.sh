#!/usr/bin/env bash

# fount脚本需要兼容mac的上古版本bash，尽量避免使用新版本语法

# 定义常量和路径
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
FOUNT_DIR=$(dirname "$SCRIPT_DIR")

# 若是 Windows 环境，则使用 fount.ps1
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
	powershell.exe -noprofile -executionpolicy bypass -file "$FOUNT_DIR\path\fount.ps1" "$@"
	exit $?
fi

# 转义后的Fount路径用于sed
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

	echo "Error: Failed to install '$command_name' using any available package manager." >&2
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

	echo "Failed to uninstall $package_name. It might not be installed or managed by a recognized package manager." >&2
	return 1
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
		echo "Error: Deno executable not found before patching. Cannot patch." >&2
		return 1
	fi

	install_package "patchelf" "patchelf" || return 1

	local interp_path
	local arch
	arch=$(uname -m)

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
		echo "Error: Unsupported architecture for patching: $arch" >&2
		return 1
		;;
	esac

	if ! patchelf --set-rpath "${ORIGIN}/../glibc/lib" --set-interpreter "$interp_path" "$deno_bin"; then
		echo "Error: Failed to patch Deno executable with patchelf." >&2
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

# 函数: 创建桌面快捷方式
create_desktop_shortcut() {
	echo "Creating desktop shortcut..."
	local shortcut_name="fount"
	local icon_path="$FOUNT_DIR/src/pages/favicon.ico"

	if [ "$OS_TYPE" = "Linux" ]; then
		install_package "xdg-open" "xdg-utils" || return 1

		local desktop_file_path="$HOME/.local/share/applications/$shortcut_name.desktop"
		mkdir -p "$(dirname "$desktop_file_path")"
		cat <<EOF >"$desktop_file_path"
[Desktop Entry]
Version=1.0
Type=Application
Name=$shortcut_name
Comment=Fount Application
Exec=$FOUNT_DIR/path/fount open keepalive
Icon=$icon_path
Terminal=true
Categories=Utility;
EOF
		chmod +x "$desktop_file_path"
		echo "Desktop shortcut created at $desktop_file_path"

		echo "Registering fount:// protocol handler..."
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
		echo "fount:// protocol handler registered."

	elif [ "$OS_TYPE" = "Darwin" ]; then
		local app_path="$HOME/Desktop/$shortcut_name.app"
		rm -rf "$app_path" # Clean up old version first
		echo "Creating macOS application bundle at $app_path"

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
	<string>$shortcut_name</string>
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
			<string>Fount Protocol</string>
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

	set final_command_in_terminal to ":; (" & command_to_execute & "; echo; echo \"Fount has exited. Press Enter to close this window...\"; read -r)"

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
			echo "Error: 'osacompile' not found. Cannot create macOS app." >&2
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
				echo "Warning: Failed to register application with LaunchServices using lsregister." >&2
				# 操你妈，跟你爆了
				killall lsd
			fi
		else
			# 操你妈，跟你爆了
			killall lsd
		fi

		if [ -d "$app_path" ]; then
			echo "Desktop application created at $app_path"
		else
			echo "Error: Failed to create Desktop application." >&2
			return 1
		fi
	else
		echo "Warning: Desktop shortcut creation not supported for your OS ($OS_TYPE)."
	fi
	return 0
}

# 函数: 移除桌面快捷方式
remove_desktop_shortcut() {
	echo "Removing desktop shortcut..."
	if [ "$OS_TYPE" = "Linux" ]; then
		rm -f "$HOME/.local/share/applications/fount.desktop" "$HOME/.local/share/applications/fount-protocol.desktop"
		if command -v update-desktop-database &>/dev/null; then
			update-desktop-database "$HOME/.local/share/applications"
		fi
		echo "Linux desktop entries removed."
	elif [ "$OS_TYPE" = "Darwin" ]; then
		rm -rf "$HOME/Desktop/fount.app"
		echo "macOS desktop application removed."
	fi
}

# 函数: 将 fount 路径添加到 PATH
ensure_fount_path() {
	if [[ ":$PATH:" != *":$FOUNT_DIR/path:"* ]]; then
		local profile_files=("$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc")
		for profile_file in "${profile_files[@]}"; do
			if [ -f "$profile_file" ] && ! grep -q "export PATH=.*$ESCAPED_FOUNT_DIR/path" "$profile_file"; then
				echo "Adding fount path to $profile_file..."
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
	open | protocolhandle)
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
		echo "Error: Fount server did not start in time." >&2; exit 1
	fi
done
echo "Fount server is running. Opening URL..." >&2
os_type=$(uname -s)
if [ "$os_type" = "Linux" ]; then
	xdg-open "$TARGET_URL" >/dev/null 2>&1
elif [ "$os_type" = "Darwin" ]; then
	open "$TARGET_URL" >/dev/null 2>&1
fi
EOF

# 参数处理: open, background, protocolhandle
if [[ $# -gt 0 ]]; then
	if [[ "$1" == "open" || "$1" == "background" || "$1" == "protocolhandle" ]] && [[ $IN_DOCKER -eq 1 || $IN_TERMUX -eq 1 ]]; then
		shift
		"$0" "$@"
		exit $?
	fi
	case "$1" in
	open)
		ensure_dependencies "open" || exit 1
		TARGET_URL='https://steve02081504.github.io/fount/wait'
		if [ "$OS_TYPE" = "Linux" ]; then
			xdg-open "$TARGET_URL" >/dev/null 2>&1
		elif [ "$OS_TYPE" = "Darwin" ]; then
			open "$TARGET_URL" >/dev/null 2>&1
		fi
		"$0" "${@:2}"
		exit $?
		;;
	background)
		nohup "$0" "${@:2}" >/dev/null 2>&1 &
		exit 0
		;;
	protocolhandle)
		protocolUrl="$2"
		if [ -z "$protocolUrl" ]; then
			echo "Error: No URL provided." >&2
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

# 函数: 升级 fount (恢复的健壮版本)
fount_upgrade() {
	ensure_dependencies "upgrade" || return 0
	if [ ! -d "$FOUNT_DIR/.git" ]; then
		echo "Fount's git repository not found, initializing a new one..."
		git -C "$FOUNT_DIR" init -b master
		git -C "$FOUNT_DIR" remote add origin https://github.com/steve02081504/fount.git
		echo "Fetching from remote and resetting to master..."
		if ! git -C "$FOUNT_DIR" fetch origin --depth 1 --single-branch; then
			echo "Failed to fetch from 'origin'."
			return 1
		fi
		git -C "$FOUNT_DIR" clean -fd
		git -C "$FOUNT_DIR" reset --hard "origin/master"
	else
		git -C "$FOUNT_DIR" fetch origin
		local currentBranch
		currentBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD)
		if [ "$currentBranch" = "HEAD" ]; then
			echo "Not on a branch, switching to 'master'..."
			git -C "$FOUNT_DIR" clean -fd
			git -C "$FOUNT_DIR" reset --hard "origin/master"
			git -C "$FOUNT_DIR" checkout master
			currentBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD)
		fi
		local remoteBranch
		remoteBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
		if [ -z "$remoteBranch" ]; then
			echo "Warning: No upstream branch configured for '$currentBranch'. Setting to 'origin/master'." >&2
			git -C "$FOUNT_DIR" branch --set-upstream-to origin/master "$currentBranch"
			remoteBranch="origin/master"
		fi
		if [ -n "$(git -C "$FOUNT_DIR" status --porcelain)" ]; then
			echo "Warning: Working directory not clean. Stash or commit your changes before updating." >&2
		fi
		local mergeBase
		mergeBase=$(git -C "$FOUNT_DIR" merge-base "$currentBranch" "$remoteBranch")
		local localCommit
		localCommit=$(git -C "$FOUNT_DIR" rev-parse "$currentBranch")
		local remoteCommit
		remoteCommit=$(git -C "$FOUNT_DIR" rev-parse "$remoteBranch")
		if [ "$localCommit" != "$remoteCommit" ]; then
			if [ "$mergeBase" = "$localCommit" ]; then
				echo "Updating from remote repository (fast-forward)..."
				git -C "$FOUNT_DIR" reset --hard "$remoteBranch"
			elif [ "$mergeBase" = "$remoteCommit" ]; then
				echo "Local branch is ahead of remote. No update needed."
			else
				echo "Branches have diverged. Force updating..."
				git -C "$FOUNT_DIR" reset --hard "$remoteBranch"
			fi
		else
			echo "Already up to date."
		fi
	fi
}

# 更新 Fount
if [ -f "$FOUNT_DIR/.noupdate" ]; then
	echo "Skipping fount update due to .noupdate file."
else
	fount_upgrade
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
		echo "Installing Deno for Termux..."
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
		echo "Deno not found, attempting to install..."
		if ! curl -fsSL https://deno.land/install.sh | sh -s -- -y; then
			echo "Deno standard installation script failed. Attempting direct download..."
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
				echo "Error: Failed to manually install Deno." >&2
				exit 1
			fi
		fi
		# shellcheck source=/dev/null
		[ -f "$HOME/.deno/env" ] && . "$HOME/.deno/env"
		export PATH="$PATH:$HOME/.deno/bin"
		touch "$AUTO_INSTALLED_DENO_FLAG"
	fi
	if ! command -v deno &>/dev/null; then
		echo "Error: Deno installation failed." >&2
		exit 1
	fi
}
install_deno

# 函数: 升级 Deno
deno_upgrade() {
	if [ $IN_DOCKER -eq 1 ]; then
		echo "Skipping Deno upgrade in Docker environment."
		return
	fi

	echo "Checking for Deno updates..."
	local deno_version_before
	deno_version_before=$(run_deno -V 2>&1)
	if [[ -z "$deno_version_before" ]]; then
		echo "Error: Could not determine current Deno version. Skipping upgrade." >&2
		return
	fi

	local deno_upgrade_channel="stable"
	if [[ "$deno_version_before" == *"+"* ]]; then
		deno_upgrade_channel="canary"
	elif [[ "$deno_version_before" == *"-rc"* ]]; then
		deno_upgrade_channel="rc"
	fi

	echo "Attempting to upgrade Deno on the '$deno_upgrade_channel' channel..."
	if ! run_deno upgrade -q "$deno_upgrade_channel"; then
		echo "Deno upgrade command failed." >&2
		if [[ $IN_TERMUX -eq 1 ]]; then
			echo "Attempting to reinstall Deno for Termux..."
			rm -rf "$HOME/.deno"
			install_deno
		else
			echo "Warning: Deno upgrade may have failed. Please check for errors." >&2
		fi
	fi
}
deno_upgrade
run_deno -V

# 函数: 运行 fount
run() {
	if [[ $(id -u) -eq 0 ]]; then
		echo "Warning: Not Recommended: Running fount as root." >&2
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
	if [[ $# -gt 0 && $1 = 'debug' ]]; then
		run_deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" "${@:2}"
	else
		run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" "$@"
	fi
	local exit_code=$?
	if [[ $IN_TERMUX -eq 1 ]]; then export LANG="$LANG_BACKUP"; fi
	return $exit_code
}

# 安装 fount 依赖
if [[ ! -d "$FOUNT_DIR/node_modules" || ($# -gt 0 && $1 = 'init') ]]; then
	if [[ -d "$FOUNT_DIR/node_modules" ]]; then run "shutdown"; fi
	echo "Installing Fount dependencies..."
	set +e # 禁用错误检测，因为第一次运行可能会失败
	run_deno install --reload --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
	run "shutdown" # 确保安装后服务能正常启动
	set -e         # 重新启用严格模式
	if [ $IN_DOCKER -eq 0 ] && [ $IN_TERMUX -eq 0 ]; then
		create_desktop_shortcut
	fi
	echo "======================================================"
	echo "WARNING: DO NOT install any untrusted fount parts on your system, they can do ANYTHING."
	echo "======================================================"
fi

# 主要参数处理逻辑
case "$1" in
init)
	exit 0
	;;
keepalive)
	runargs=("${@:2}")
	while ! run "${runargs[@]}"; do
		echo "Fount exited with an error, attempting to upgrade and restart..." >&2
		deno_upgrade
		fount_upgrade
		run "${runargs[@]}"
	done
	;;
remove)
	echo "Initiating fount uninstallation..."
	run shutdown
	profile_files=("$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc")
	for profile_file in "${profile_files[@]}"; do
		if [ -f "$profile_file" ]; then
			# shellcheck disable=SC2016
			run_sed_inplace '/export PATH="\$PATH:'"$ESCAPED_FOUNT_DIR"'\/path"/d' "$profile_file"
		fi
	done
	PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$FOUNT_DIR/path" | grep -v "$HOME/.deno/bin" | tr '\n' ':' | sed 's/:*$//')
	export PATH
	remove_desktop_shortcut
	if [[ $IN_TERMUX -eq 1 ]]; then
		for package in "${INSTALLED_PACMAN_PACKAGES_ARRAY[@]}"; do pacman -R --noconfirm "$package"; done
	fi
	load_installed_packages
	for package in "${INSTALLED_SYSTEM_PACKAGES_ARRAY[@]}"; do uninstall_package "$package"; done
	if [ -f "$AUTO_INSTALLED_DENO_FLAG" ]; then
		echo "Uninstalling Deno..."
		rm -rf "$HOME/.deno"
		for profile_file in "${profile_files[@]}"; do
			if [ -f "$profile_file" ]; then run_sed_inplace '/\.deno/d' "$profile_file"; fi
		done
		rm -f "$AUTO_INSTALLED_DENO_FLAG"
	fi
	echo "Removing fount installation directory: $FOUNT_DIR"
	rm -rf "$FOUNT_DIR"
	# 进一步ls和删除$FOUNT_DIR的父目录直到其不为空
	parent_dir=$(dirname "$FOUNT_DIR")
	while rmdir "$parent_dir" 2>/dev/null; do
		echo "Removed empty parent directory: $parent_dir"
		parent_dir=$(dirname "$parent_dir")
	done
	echo "Fount uninstallation complete."
	exit 0
	;;
*)
	run "$@"
	;;
esac

exit $?
