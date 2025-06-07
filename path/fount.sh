#!/bin/bash

# 定义常量和路径
SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
FOUNT_DIR=$(dirname "$SCRIPT_DIR")

# 若是 Windows 环境，则使用 fount.ps1
if [[ "$OSTYPE" == "msys" ]]; then
	powerShell.exe -noprofile -executionpolicy bypass -file "$FOUNT_DIR\path\fount.ps1" $@
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
	mkdir -p "$INSTALLER_DATA_DIR" # 确保目录存在
	if [[ -f "$INSTALLED_SYSTEM_PACKAGES_FILE" ]]; then
		# 读取内容，按分号分割并转换为数组
		# 使用 tr -d '\n' 移除换行符，防止IFS读取时产生空元素
		IFS=';' read -r -a INSTALLED_SYSTEM_PACKAGES_ARRAY <<< "$(cat "$INSTALLED_SYSTEM_PACKAGES_FILE" | tr -d '\n')"
	fi
	if [[ -f "$INSTALLED_PACMAN_PACKAGES_FILE" ]]; then
		IFS=';' read -r -a INSTALLED_PACMAN_PACKAGES_ARRAY <<< "$(cat "$INSTALLED_PACMAN_PACKAGES_FILE" | tr -d '\n')"
	fi
}

# 保存已安装的包列表
save_installed_packages() {
	mkdir -p "$INSTALLER_DATA_DIR"
	# 将数组元素用分号连接起来，写入文件
	(IFS=';'; echo "${INSTALLED_SYSTEM_PACKAGES_ARRAY[*]}") > "$INSTALLED_SYSTEM_PACKAGES_FILE"
	if [[ $IN_TERMUX -eq 1 ]]; then
		(IFS=';'; echo "${INSTALLED_PACMAN_PACKAGES_ARRAY[*]}") > "$INSTALLED_PACMAN_PACKAGES_FILE"
	fi
}

# 首次载入
load_installed_packages

# 检测是否在 Docker 环境中
IN_DOCKER=0
if [ -f "/.dockerenv" ] || grep -q 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
	IN_DOCKER=1
fi

# 检测是否在 Termux 环境中
IN_TERMUX=0
if [[ -d "/data/data/com.termux" ]]; then
	IN_TERMUX=1
fi

# 检查操作系统类型
OS_TYPE=$(uname -s) # "Linux" or "Darwin" (for macOS)

# 函数: 检查包是否已在数组中
# $1: 包名
# $2: 数组的名称字符串 (例如 "INSTALLED_SYSTEM_PACKAGES_ARRAY")
is_package_tracked() {
	local package="$1"
	local array_name="$2" # 接收数组的名称字符串

	# 使用间接扩展来遍历数组
	# 要访问名为 $array_name 的数组的元素，使用 ${!array_name[@]}
	local p
	for p in "${!array_name[@]}"; do
		if [[ "$p" == "$package" ]]; then
			return 0 # Found
		fi
	done
	return 1 # Not found
}

# 函数: 将包添加到数组并保存
# $1: 包名
# $2: 数组的名称字符串
add_package_to_tracker() {
	local package="$1"
	local array_name="$2" # 接收数组的名称字符串

	# 检查是否已跟踪
	if ! is_package_tracked "$package" "$array_name"; then
		# 使用 eval 进行间接赋值，将新元素添加到指定名称的数组
		eval "${array_name}+=(\"$package\")"
		save_installed_packages
	fi
}

# 函数: 安装包
# $1: 包名
install_package() {
	local package_name="$1"

	# 检查是否已经通过 command -v 安装成功
	if command -v "$package_name" &> /dev/null; then
		return 0
	fi

	local install_successful=0

	if command -v pkg &> /dev/null; then
		pkg install -y "$package_name" && install_successful=1
	fi
	if [[ install_successful -eq 0 ]] && command -v snap &> /dev/null; then
		snap install "$package_name" && install_successful=1
	fi
	if [[ install_successful -eq 0 ]] && command -v apt-get &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo apt-get update -y
			sudo apt-get install -y "$package_name" && install_successful=1
		else
			apt-get update -y
			apt-get install -y "$package_name" && install_successful=1
		fi
	fi
	if [[ install_successful -eq 0 ]] && command -v brew &> /dev/null; then
		if ! brew list --formula "$package_name" &> /dev/null; then
			brew install "$package_name" && install_successful=1
		fi
	fi
	if [[ install_successful -eq 0 ]] && command -v pacman &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo pacman -Syy
			sudo pacman -S --needed --noconfirm "$package_name" && install_successful=1
		else
			pacman -Syy
			pacman -S --needed --noconfirm "$package_name" && install_successful=1
		fi
	fi
	if [[ install_successful -eq 0 ]] && command -v dnf &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo dnf install -y "$package_name" && install_successful=1
		else
			dnf install -y "$package_name" && install_successful=1
		fi
	fi
	if [[ install_successful -eq 0 ]] && command -v yum &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo yum install -y "$package_name" && install_successful=1
		else
			yum install -y "$package_name" && install_successful=1
		fi
	fi
	if [[ install_successful -eq 0 ]] && command -v zypper &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo zypper install -y --no-confirm "$package_name" && install_successful=1
		else
			zypper install -y --no-confirm "$package_name" && install_successful=1
		fi
	fi
	if [[ install_successful -eq 0 ]] && command -v apk &> /dev/null; then
		apk add --update "$package_name" && install_successful=1
	fi

	if [[ $install_successful -eq 1 ]]; then
		add_package_to_tracker "$package_name" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
		return 0
	else
		echo "Error: $package_name installation failed." >&2
		return 1
	fi
}

# 函数: 卸载包
# $1: 包名
uninstall_package() {
	local package_name="$1"
	echo "Attempting to uninstall $package_name..."

	if command -v pkg &> /dev/null; then
		pkg uninstall -y "$package_name" && { echo "$package_name uninstalled via pkg."; return 0; }
	fi
	if command -v snap &> /dev/null; then
		snap remove "$package_name" && { echo "$package_name uninstalled via snap."; return 0; }
	fi
	if command -v apt-get &> /dev/null; then
		# 使用 purge 以便彻底删除配置文件
		if command -v sudo &> /dev/null; then
			sudo apt-get purge -y "$package_name"
		else
			apt-get purge -y "$package_name"
		fi && { echo "$package_name uninstalled via apt-get."; return 0; }
	fi
	if command -v brew &> /dev/null; then
		brew uninstall "$package_name" && { echo "$package_name uninstalled via brew."; return 0; }
	fi
	if command -v pacman &> /dev/null; then
		# 使用 -Rns 移除包及其不再需要的依赖和配置文件
		if command -v sudo &> /dev/null; then
			sudo pacman -Rns --noconfirm "$package_name"
		else
			pacman -Rns --noconfirm "$package_name"
		fi && { echo "$package_name uninstalled via pacman."; return 0; }
	fi
	if command -v dnf &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo dnf remove -y "$package_name"
		else
			dnf remove -y "$package_name"
		fi && { echo "$package_name uninstalled via dnf."; return 0; }
	fi
	if command -v yum &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo yum remove -y "$package_name"
		else
			yum remove -y "$package_name"
		fi && { echo "$package_name uninstalled via yum."; return 0; }
	fi
	if command -v zypper &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo zypper remove -y --no-confirm "$package_name"
		else
			zypper remove -y --no-confirm "$package_name"
		fi && { echo "$package_name uninstalled via zypper."; return 0; }
	fi
	if command -v apk &> /dev/null; then
		apk del "$package_name" && { echo "$package_name uninstalled via apk."; return 0; }
	fi

	echo "Failed to uninstall $package_name via any recognized package manager." >&2
	return 1
}

# 函数: 运行 Deno，考虑 glibc-runner 如果可用，以及 .glibc.sh 包装器
run_deno() {
	local deno_args=("$@")
	local deno_cmd="deno"  # Default to deno

	if [[ $IN_TERMUX -eq 1 ]]; then
		if command -v deno.glibc.sh &> /dev/null; then
			deno_cmd="deno.glibc.sh"
		elif command -v glibc-runner &> /dev/null; then
			deno_cmd="glibc-runner $(which deno)"
		else
			echo "Warning: glibc-runner and deno.glibc.sh not found, falling back to plain deno in Termux (may not work)." >&2
		fi
	fi
	"$deno_cmd" "${deno_args[@]}"
}

# 函数: 为 Termux 打补丁 Deno 可执行文件
patch_deno() {
	local deno_bin=$(which deno)

	if [[ -z "$deno_bin" ]]; then
		echo "Error: Deno executable not found before patching. Cannot patch." >&2
		return 1
	fi

	if ! command -v patchelf &> /dev/null; then
		echo "patchelf is not installed. Please install it." >&2
		return 1
	fi

	# 使用更通用的 rpath 和正确的 interpreter 路径
	patchelf --set-rpath '${ORIGIN}/../glibc/lib' --set-interpreter "${PREFIX}/glibc/lib/ld-linux-aarch64.so.1" "$deno_bin"

	if [ $? -ne 0 ]; then
		echo "Error: Failed to patch Deno executable with patchelf." >&2
		return 1
	else
		# 创建包装脚本 (Termux)
		mkdir -p ~/.deno/bin
		cat > ~/.deno/bin/deno.glibc.sh << 'EOF'
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

# 新增函数: URL 编码 (用于 Bash, 将特殊字符转换为 %XX 格式)
urlencode() {
	local string="$1"
	local strlen=${#string}
	local encoded=""
	local pos c o

	for (( pos=0 ; pos<strlen ; pos++ )); do
		c="${string:$pos:1}"
		case "$c" in
			[-_.~a-zA-Z0-9] ) o="${c}" ;;
			* )               printf -v o '%%%02X' "'$c" # 使用大写十六进制
		esac
		encoded+="${o}"
	done
	echo "${encoded}"
}

# 函数: 创建桌面快捷方式 (及 macOS 协议注册)
create_desktop_shortcut() {
	echo "Creating desktop shortcut..."
	local shortcut_name="fount"
	local icon_path="$FOUNT_DIR/src/public/favicon.ico" # 使用绝对路径

	if [ "$OS_TYPE" = "Linux" ]; then
		local desktop_file_path="$HOME/.local/share/applications/$shortcut_name.desktop"
		if [ -f "$desktop_file_path" ]; then
			echo "Removing old desktop shortcut at $desktop_file_path"
			rm "$desktop_file_path"
		fi
		mkdir -p "$(dirname "$desktop_file_path")"
		cat <<EOF > "$desktop_file_path"
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

		# 新增：注册 fount:// 协议处理程序 (Linux)
		echo "Registering fount:// protocol handler for Linux..."
		local protocol_desktop_file_path="$HOME/.local/share/applications/fount-protocol.desktop"
		mkdir -p "$(dirname "$protocol_desktop_file_path")"
		cat <<EOF > "$protocol_desktop_file_path"
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
		# 设置为默认处理程序
		xdg-mime default fount-protocol.desktop x-scheme-handler/fount
		# 更新桌面数据库以确保立即生效
		if command -v update-desktop-database &> /dev/null; then
			update-desktop-database "$HOME/.local/share/applications"
		fi
		echo "fount:// protocol handler registered for Linux."
	elif [ "$OS_TYPE" = "Darwin" ]; then # macOS
		local app_path="$HOME/Desktop/$shortcut_name.app"
		local icns_path="$FOUNT_DIR/src/public/favicon.icns"
		local macos_launcher_path="$app_path/Contents/MacOS/fount-launcher"
		# 已编译的 AppleScript 将放在 Resources 目录
		local compiled_applescript_in_resources="$app_path/Contents/Resources/fount-launcher.scpt"
		local temp_applescript_file="/tmp/fount_launcher_script.applescript"

		if [ -d "$app_path" ]; then
			echo "Removing old macOS application bundle at $app_path"
			rm -rf "$app_path"
		fi

		echo "Creating macOS application bundle at $app_path"

		# 1. 创建 .app 目录结构
		mkdir -p "$app_path/Contents/MacOS" "$app_path/Contents/Resources"

		# 2. 转换 .ico 到 .icns 格式以获得更好的应用图标兼容性
		if [ ! -f "$icns_path" ]; then
			echo "Converting favicon.ico to favicon.icns for better app icon compatibility..."
			if command -v sips &> /dev/null; then
				sips -s format icns "$icon_path" --out "$icns_path"
				if [ $? -ne 0 ]; then
					echo "Warning: Failed to convert icon to .icns. Using original .ico and hoping for the best." >&2
					# 如果转换失败，尝试直接使用 .ico 文件，虽然可能显示不佳
					cp "$icon_path" "$app_path/Contents/Resources/favicon.ico"
					icon_name="favicon.ico"
				else
					cp "$icns_path" "$app_path/Contents/Resources/favicon.icns"
					icon_name="favicon.icns"
				fi
			else
				echo "Warning: 'sips' command not found, cannot convert icon to .icns. Using original .ico directly." >&2
				cp "$icon_path" "$app_path/Contents/Resources/favicon.ico"
				icon_name="favicon.ico"
			fi
		else
			cp "$icns_path" "$app_path/Contents/Resources/favicon.icns"
			icon_name="favicon.icns"
		fi

		# 3. 创建 Info.plist 文件 (CFBundleExecutable 指向新的 shell 脚本)
		cat <<EOF > "$app_path/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDevelopmentRegion</key>
	<string>en</string>
	<key>CFBundleExecutable</key>
	<string>fount-launcher</string> <!-- Points to our new shell script launcher -->
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

		# 4. 创建 AppleScript 启动器内容的临时文件 (这部分不变)
		cat <<EOF > "$temp_applescript_file"
on run argv
	-- 获取当前应用包的路径 (fount.app/Contents/MacOS/fount-launcher 或 fount.app/Contents/Resources/fount-launcher.scpt)
	-- 注意：这里的 path to me 会根据 osascript 执行的脚本来。如果直接执行 .scpt，则 path to me 是 .scpt 的路径。
	-- 我们将这个 AppleScript 作为通用逻辑，由外部的 shell 脚本调用。
	-- 所以这里的 fount_dir_path 需要直接从 shell 脚本传入或硬编码。
	-- 这里使用硬编码的 "$FOUNT_DIR" 是正确的。
	set fount_dir_path to POSIX path of "$FOUNT_DIR"

	-- 构建要执行的实际 fount 脚本的完整路径
	set fount_command_path to fount_dir_path & "/path/fount"
	set command_to_execute to quoted form of fount_command_path

	-- 如果没有传递任何参数，默认执行 'open keepalive'
	if (count of argv) is 0 then
		set command_to_execute to command_to_execute & " open keepalive"
	else
		-- 将所有传入的参数添加到命令中
		repeat with i from 1 to count of argv
			set command_to_execute to command_to_execute & " " & quoted form of (item i of argv)
		end repeat
	end if

	-- 将主命令和退出提示合并成一个单一的命令字符串。
	-- 'read -r' 只会在主命令 (keepalive 循环) 正常结束后执行。
	set final_command_in_terminal to command_to_execute & "; echo ''; echo 'Fount has exited. Press Enter to close this window...'; read -r"

	-- 在 Terminal.app 中执行这个合并后的命令。
	tell application "Terminal"
		activate
		set new_window to do script final_command_in_terminal
	end tell
end run
EOF

		# 5. 编译 AppleScript 到 Resources 目录
		if command -v osacompile &> /dev/null; then
			osacompile -o "$compiled_applescript_in_resources" "$temp_applescript_file"
			if [ $? -ne 0 ]; then
				echo "Error: Failed to compile AppleScript. Cannot create macOS app shortcut." >&2
				rm -rf "$app_path"
				rm "$temp_applescript_file"
				return 1
			fi
		else
			echo "Error: 'osacompile' command not found. Cannot create macOS app shortcut. Please install Xcode Command Line Tools." >&2
			rm -rf "$app_path"
			rm "$temp_applescript_file"
			return 1
		fi

		# 6. 创建真正的 fount-launcher shell 脚本
		cat <<EOF > "$macos_launcher_path"
#!/bin/bash
# 这个脚本是 fount.app 的入口点，它会调用 osascript 来执行已编译的 AppleScript。

# 获取当前 shell 脚本的目录
SCRIPT_DIR="\$(dirname "\$0")"

# 已编译的 AppleScript 文件路径 (相对于这个 shell 脚本的路径)
COMPILED_APPLESCRIPT_PATH="\$SCRIPT_DIR/../Resources/fount-launcher.scpt"

# 将所有命令行参数传递给 AppleScript
# osascript 会自动处理参数传递给 AppleScript 的 'run argv' handler
osascript "\$COMPILED_APPLESCRIPT_PATH" "\$@"

EOF

		# 7. 确保应用可执行权限 (Recursive)
		chmod -R u+rwx "$app_path"
		xattr -dr com.apple.quarantine "$app_path"

		# 8. 刷新 LaunchServices 数据库以注册协议和图标
		local LSREGISTER_PATH="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
		if [ -f "$LSREGISTER_PATH" ]; then
			echo "Refreshing LaunchServices database with $LSREGISTER_PATH..."
			"$LSREGISTER_PATH" -f "$app_path"
			if [ $? -ne 0 ]; then
				echo "Warning: Failed to register application with LaunchServices using lsregister." >&2
				# 操你妈，跟你爆了
				killall -KILL lsd
			fi
		else
			# 操你妈，跟你爆了
			killall -KILL lsd
		fi

		if [ -d "$app_path" ]; then
			echo "Desktop application created at $app_path"
		else
			echo "Error: Failed to create Desktop application." >&2
			return 1
		fi
	else
		echo "Warning: Desktop shortcut and protocol registration not fully supported for your OS ($OS_TYPE)."
	fi
	return 0
}

# 函数: 移除桌面快捷方式 (及 macOS/Linux 协议注册)
remove_desktop_shortcut() {
	echo "Removing desktop shortcut..."
	local shortcut_name="fount"

	if [ "$OS_TYPE" = "Linux" ]; then
		local desktop_file_path="$HOME/.local/share/applications/$shortcut_name.desktop"
		if [ -f "$desktop_file_path" ]; then
			rm "$desktop_file_path"
			echo "Desktop shortcut removed."
		else
			echo "Desktop shortcut not found."
		fi
		# 移除 fount:// 协议处理程序 (Linux) - 新增
		local protocol_desktop_file_path="$HOME/.local/share/applications/fount-protocol.desktop"
		if [ -f "$protocol_desktop_file_path" ]; then
			rm "$protocol_desktop_file_path"
			echo "fount:// protocol handler desktop entry removed."
			# 可选地更新桌面数据库
			if command -v update-desktop-database &> /dev/null; then
				update-desktop-database "$HOME/.local/share/applications"
			fi
		else
			echo "fount:// protocol handler desktop entry not found."
		fi
	elif [ "$OS_TYPE" = "Darwin" ]; then # macOS
		local app_path="$HOME/Desktop/$shortcut_name.app"
		if [ -d "$app_path" ]; then
			echo "Removing macOS application bundle at $app_path"
			rm -rf "$app_path"
			echo "Desktop application removed."
		else
			echo "Desktop application not found."
		fi
	else
		echo "Skipping desktop shortcut and protocol handler removal for unsupported OS ($OS_TYPE)."
	fi
}

# 将 fount 路径添加到 PATH (如果尚未添加)
ensure_fount_path() {
	if ! command -v fount.sh &> /dev/null; then
		local profile_files=("$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc")
		for profile_file in "${profile_files[@]}"; do
			if ! grep -q "export PATH=.*$FOUNT_DIR/path" "$profile_file" 2>/dev/null; then
				echo "Adding fount path to $profile_file..."
				if [ ! -f "$profile_file" ]; then
					touch "$profile_file"
				fi
				# remove old fount path first
				if [ "$OS_TYPE" = "Darwin" ]; then
					sed -i '' '/export PATH="\$PATH:'"$ESCAPED_FOUNT_DIR\/path"'"/d' "$profile_file"
				else
					sed -i '/export PATH="\$PATH:'"$ESCAPED_FOUNT_DIR\/path"'"/d' "$profile_file"
				fi
				# 若profile不是\n结尾，加上
				if [ "$(tail -c 1 "$profile_file")" != $'\n' ]; then
					echo >> "$profile_file"
				fi
				echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >> "$profile_file"
			fi
		done
		# 立即更新当前 shell 的 PATH
		export PATH="$PATH:$FOUNT_DIR/path"
	fi
}
ensure_fount_path

# 处理 'open' 参数
if [[ $# -gt 0 && $1 = 'open' ]]; then
	# 确保 netcat 或 socat 可用
	if ! command -v nc &> /dev/null && ! command -v socat &> /dev/null; then
		install_package netcat || install_package socat
		if ! command -v nc &> /dev/null && ! command -v socat &> /dev/null; then
			echo "Error: Failed to install netcat or socat. Cannot communicate with fount server for 'open' command." >&2
			exit 1
		fi
	fi
	# 确保 jq 可用
	if ! command -v jq &> /dev/null; then
		echo "Error: 'jq' not found. Attempting to install jq..." >&2
		install_package jq
		if ! command -v jq &> /dev/null; then
			echo "Error: Failed to install jq. Cannot parse fount server responses for 'open' command." >&2
			exit 1
		fi
	fi

	# 在新的独立 shell 进程中等待 fount 服务启动，并打开网页
	# 将 fount_ipc 和 test_fount_running 定义嵌入到 nohup 块中，以确保它们在子进程中可用
	cat << 'EOF_OPEN_JOB' | nohup bash >/dev/null 2>&1 &
# 函数: 与 fount 服务器进行 IPC 通信 (内部定义，避免父子进程环境问题)
fount_ipc_internal() {
	local type="$1"
	local data="$2"
	local hostname="${3:-localhost}"
	local port="${4:-16698}"

	local command_json="{\"type\":\"$type\",\"data\":$data}"
	local response=""
	if command -v nc &> /dev/null; then
		response=$(echo "$command_json" | nc -w 3 "$hostname" "$port" 2>/dev/null)
	elif command -v socat &> /dev/null; then
		response=$(echo "$command_json" | socat -T 3 - TCP:"$hostname":"$port",nodelay 2>/dev/null)
	fi

	if [ -z "$response" ]; then return 1; fi # 静默失败
	local status=$(echo "$response" | jq -r '.status // empty')
	if [ "$status" = "ok" ]; then return 0; else return 1; fi
}

# 函数: 检查 fount 进程是否正在运行 (内部定义)
test_fount_running_internal() {
	fount_ipc_internal "ping" "{}"
}

local timeout_seconds=60 # 等待超时时间
local elapsed_seconds=0
local ping_interval=1    # 每次 ping 间隔

while ! test_fount_running_internal; do
	echo "Fount server not running, waiting... ($elapsed_seconds/$timeout_seconds seconds)" >&2
	sleep "$ping_interval"
	elapsed_seconds=$((elapsed_seconds + ping_interval))
	if [ "$elapsed_seconds" -ge "$timeout_seconds" ]; then
		echo "Error: Fount server did not start in time. Aborting 'open' command." >&2
		exit 1
	fi
done
echo "Fount server is running." >&2

# 打开网址
echo "Opening fount protocol URL..." >&2
local OS_TYPE_INTERNAL=$(uname -s) # 重新获取，确保在子进程中也正确
if [ "$OS_TYPE_INTERNAL" = "Linux" ]; then
	xdg-open 'https://steve02081504.github.io/fount/protocol' >/dev/null 2>&1
elif [ "$OS_TYPE_INTERNAL" = "Darwin" ]; then
	open 'https://steve02081504.github.io/fount/protocol' >/dev/null 2>&1
else
	echo "Warning: Cannot open URL automatically on your OS ($OS_TYPE_INTERNAL)." >&2
fi
EOF_OPEN_JOB

	# 将剩余参数传递给 fount 运行 (例如 'keepalive')
	$FOUNT_DIR/path/fount.sh "${@:2}" # 从第二个参数开始传递给fount
	exit $? # 确保在后台进程启动后，主脚本可以退出
# 处理 'background' 参数
elif [[ $# -gt 0 && $1 = 'background' ]]; then
	if command -v fount &> /dev/null; then
		# 注意：这里使用 nohup 确保在父 shell 退出后进程继续运行
		nohup "$FOUNT_DIR/path/fount" "${@:2}" > /dev/null 2>&1 &
		exit 0
	else
		echo "Error: This script requires fount to be installed for background operation." >&2
		exit 1
	fi
# 新增: 处理 'protocolhandle' 参数
elif [[ $# -gt 0 && $1 = 'protocolhandle' ]]; then
	local protocolUrl="$2"
	if [ -z "$protocolUrl" ]; then
		echo "Error: No URL provided for protocolhandle." >&2
		exit 1
	fi

	# 确保依赖 (jq, netcat/socat) 已安装，因为它们是 IPC 通信所必需的
	if ! command -v nc &> /dev/null && ! command -v socat &> /dev/null; then
		install_package netcat || install_package socat
		if ! command -v nc &> /dev/null && ! command -v socat &> /dev/null; then
			echo "Error: Failed to install netcat or socat. Cannot communicate with fount server for protocol handling." >&2
			exit 1
		fi
	fi
	if ! command -v jq &> /dev/null; then
		echo "Error: 'jq' not found. Attempting to install jq..." >&2
		install_package jq
		if ! command -v jq &> /dev/null; then
			echo "Error: Failed to install jq. Cannot parse fount server responses for protocol handling." >&2
			exit 1
		fi
	fi

	local encodedUrl=$(urlencode "$protocolUrl")
	local targetUrl="https://steve02081504.github.io/fount/protocol/?url=$encodedUrl"

	# 启动一个后台 job，它将等待 fount 服务运行，然后打开目标 URL
	# 将 fount_ipc 和 test_fount_running 定义嵌入到 nohup 块中，以确保它们在子进程中可用
	cat << EOF_PROTOCOL_JOB | nohup bash >/dev/null 2>&1 &
# 函数: 与 fount 服务器进行 IPC 通信 (内部定义，避免父子进程环境问题)
fount_ipc_internal() {
	local type="\$1"
	local data="\$2"
	local hostname="\${3:-localhost}"
	local port="\${4:-16698}"

	local command_json="{\"type\":\"\$type\",\"data\":\$data}"
	local response=""
	if command -v nc &> /dev/null; then
		response=\$(echo "\$command_json" | nc -w 3 "\$hostname" "\$port" 2>/dev/null)
	elif command -v socat &> /dev/null; then
		response=\$(echo "\$command_json" | socat -T 3 - TCP:"\$hostname":"\$port",nodelay 2>/dev/null)
	fi

	if [ -z "\$response" ]; then return 1; fi
	local status=\$(echo "\$response" | jq -r '.status // empty')
	if [ "\$status" = "ok" ]; then return 0; else return 1; fi
}

# 函数: 检查 fount 进程是否正在运行 (内部定义)
test_fount_running_internal() {
	fount_ipc_internal "ping" "{}"
}

local timeout_seconds=60 # 等待超时时间
local elapsed_seconds=0
local ping_interval=1    # 每次 ping 间隔

while ! test_fount_running_internal; do
	echo "Fount server not running for protocol handle, waiting... (\$elapsed_seconds/\$timeout_seconds seconds)" >&2
	sleep "\$ping_interval"
	elapsed_seconds=\$((elapsed_seconds + ping_interval))
	if [ "\$elapsed_seconds" -ge "\$timeout_seconds" ]; then
		echo "Error: Fount server did not start in time for protocol handle. Aborting." >&2
		exit 1
	fi
done
echo "Fount server is running for protocol handle." >&2

echo "Opening fount protocol URL: \$targetUrl" >&2
local OS_TYPE_INTERNAL=\$(uname -s) # 重新获取，确保在子进程中也正确
if [ "\$OS_TYPE_INTERNAL" = "Linux" ]; then
	xdg-open "$targetUrl" >/dev/null 2>&1
elif [ "\$OS_TYPE_INTERNAL" = "Darwin" ]; then
	open "$targetUrl" >/dev/null 2>&1
else
	echo "Warning: Cannot open URL automatically on your OS (\$OS_TYPE_INTERNAL)." >&2
fi
EOF_PROTOCOL_JOB

	$FOUNT_DIR/path/fount.sh "${@:3}"
	exit $?
fi
EOF_PROTOCOL_JOB

# 检查并安装 Git (如果需要)
if ! command -v git &> /dev/null; then
	echo "Git is not installed, attempting to install..."
	install_package git
fi

# 函数: 升级 fount
fount_upgrade() {
	if ! command -v git &> /dev/null; then # 确保 git 已安装
		echo "Git is not installed, skipping fount update."
		return 0
	fi
	if [ ! -d "$FOUNT_DIR/.git" ]; then
		echo "Fount repository not found, cloning..."
		rm -rf "$FOUNT_DIR/.git-clone"  # 移除任何旧的 .git-clone 目录
		mkdir -p "$FOUNT_DIR/.git-clone"
		git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1 --single-branch
		if [ $? -ne 0 ]; then
			echo "Error: Failed to clone fount repository. Check connection or configuration." >&2
			exit 1
		fi
		mv "$FOUNT_DIR/.git-clone/.git" "$FOUNT_DIR/.git"
		rm -rf "$FOUNT_DIR/.git-clone"
		git -C "$FOUNT_DIR" fetch origin
		git -C "$FOUNT_DIR" clean -fd
		git -C "$FOUNT_DIR" reset --hard "origin/master"
		git -C "$FOUNT_DIR" checkout master
	else
		# 仓库存在：更新逻辑
		if [ ! -d "$FOUNT_DIR/.git" ]; then # 再次检查仓库是否存在
			echo "Repository not found at $FOUNT_DIR/.git, skipping git pull." >&2
		else
			# 获取最新更改
			git -C "$FOUNT_DIR" fetch origin

			# 获取当前分支名称
			currentBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD)

			# 处理分离的 HEAD (与 PowerShell 脚本类似)
			if [ "$currentBranch" = "HEAD" ]; then
				echo "Not on a branch, switching to 'master'..."
				git -C "$FOUNT_DIR" clean -fd
				git -C "$FOUNT_DIR" reset --hard "origin/master"
				git -C "$FOUNT_DIR" checkout master
				currentBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD) # 重新读取
			fi

			# 获取上游分支 (如果有)
			remoteBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)

			# 如果没有上游分支，则设置为 origin/master
			if [ -z "$remoteBranch" ]; then
				echo "Warning: No upstream branch configured for '$currentBranch'. Setting upstream to 'origin/master'." >&2
				git -C "$FOUNT_DIR" branch --set-upstream-to origin/master "$currentBranch"
				remoteBranch="origin/master" # 设置以保持一致性
			fi

			# 检查是否有未提交的更改
			status=$(git -C "$FOUNT_DIR" status --porcelain)
			if [ -n "$status" ]; then
				echo "Warning: Working directory is not clean. Stash or commit your changes before updating." >&2
			fi

			# 获取合并基础、本地提交和远程提交
			mergeBase=$(git -C "$FOUNT_DIR" merge-base "$currentBranch" "$remoteBranch")
			localCommit=$(git -C "$FOUNT_DIR" rev-parse "$currentBranch")
			remoteCommit=$(git -C "$FOUNT_DIR" rev-parse "$remoteBranch")

			# 比较提交并相应地更新
			if [ "$localCommit" != "$remoteCommit" ]; then
				if [ "$mergeBase" = "$localCommit" ]; then
					echo "Updating from remote repository (fast-forward)..."
					git -C "$FOUNT_DIR" fetch origin
					git -C "$FOUNT_DIR" reset --hard "$remoteBranch"
				elif [ "$mergeBase" = "$remoteCommit" ]; then
					echo "Local branch is ahead of remote. No update needed."
				else
					echo "Local and remote branches have diverged. Force updating..."
					git -C "$FOUNT_DIR" fetch origin
					git -C "$FOUNT_DIR" reset --hard "$remoteBranch"
				fi
			else
				echo "Already up to date."
			fi
		fi
	fi
}

# 检查 .noupdate 文件，跳过 fount 更新
if [ -f "$FOUNT_DIR/.noupdate" ]; then
	echo "Skipping fount update due to .noupdate file."
else
	fount_upgrade
fi

# 检查 Deno 安装
# 对于非 Termux 环境，如果 Deno 不存在，则安装。
# 对于 Termux 环境，如果 ~/.deno/bin/deno.glibc.sh 不存在，则安装。
install_deno() {
	# 若没有deno但有$HOME/.deno/env
	if [[ -z "$(command -v deno)" && -f "$HOME/.deno/env" ]]; then
		. "$HOME/.deno/env"
	fi
	if [[ ($IN_TERMUX -eq 0 && -z "$(command -v deno)") || ($IN_TERMUX -eq 1 && ! -f ~/.deno/bin/deno.glibc.sh) ]]; then
		if [[ $IN_TERMUX -eq 1 ]]; then
			echo "Installing Deno for Termux..."
			# 安装 glibc-runner，并记录它是否被自动安装
			if ! command -v glibc-runner &> /dev/null; then
				set -e # 启用严格模式，遇到错误立即退出

				# 升级 pkg，安装必要的工具
				if ! command -v patchelf &> /dev/null; then
					add_package_to_tracker "patchelf" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
				fi
				if ! command -v which &> /dev/null; then
					add_package_to_tracker "which" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
				fi
				if ! command -v time &> /dev/null; then
					add_package_to_tracker "time" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
				fi
				if ! command -v ldd &> /dev/null; then
					add_package_to_tracker "ldd" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
				fi
				if ! command -v tree &> /dev/null; then
					add_package_to_tracker "tree" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
				fi
				if ! command -v pacman &> /dev/null; then
					add_package_to_tracker "pacman" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
				fi
				yes y | pkg upgrade -y
				pkg install -y pacman patchelf which time ldd tree

				# 初始化和更新 pacman
				pacman-key --init
				pacman-key --populate
				pacman -Syu --noconfirm

				pacman -Sy glibc-runner --assume-installed bash,patchelf,resolv-conf --noconfirm
				if [ $? -eq 0 ]; then
					add_package_to_tracker "glibc-runner" "INSTALLED_PACMAN_PACKAGES_ARRAY"
				fi
				set +e # 关闭严格模式
			fi

			# 安装 Deno.js
			curl -fsSL https://deno.land/install.sh | sh -s -- -y
			DENO_INSTALL="${HOME}/.deno"
			DENO_BIN_PATH="${DENO_INSTALL}/bin/deno"

			# 显式设置可执行权限
			chmod +x "$DENO_BIN_PATH"

			# 处理 PATH 和 DENO_INSTALL 环境变量的持久化
			local profile_file_deno="$HOME/.profile"
			if [[ "$SHELL" == *"/zsh" ]]; then
				profile_file_deno="$HOME/.zshrc"
			elif [[ "$SHELL" == *"/bash" ]]; then
				profile_file_deno="$HOME/.bashrc"
			fi
			if [[ ! -f "$profile_file_deno" ]] && [[ -f "$HOME/.profile" ]]; then
				profile_file_deno="$HOME/.profile"
			elif [[ ! -f "$profile_file_deno" ]] && [[ ! -f "$HOME/.profile" ]]; then
				touch "$HOME/.profile"
				profile_file_deno="$HOME/.profile"
			fi

			# 若profile不是\n结尾，加上
			if [ "$(tail -c 1 "$profile_file_deno")" != $'\n' ]; then
				echo >> "$profile_file_deno"
			fi
			if ! grep -q "export DENO_INSTALL=.*" "$profile_file_deno" 2>/dev/null; then
				echo "export DENO_INSTALL=\"${HOME}/.deno\"" >> "$profile_file_deno"
			fi
			if ! grep -q "export PATH=.*${HOME}/.deno/bin" "$profile_file_deno" 2>/dev/null; then
				echo "export PATH=\"\$PATH:${HOME}/.deno/bin\"" >> "$profile_file_deno"
			fi
			# 重新加载 shell 配置文件以更新 PATH (当前会话)
			source "$profile_file_deno" &> /dev/null

			# 尝试使用 glibc-runner 运行 Deno，使用绝对路径(在 source 之后)
			if [ -n "$(which glibc-runner 2>/dev/null)" ]; then # 确保 glibc-runner 存在
				if ! "$(which glibc-runner)" "$DENO_BIN_PATH" -V &> /dev/null; then
					echo "Error: Deno failed to execute with glibc-runner after initial install. Removing incomplete installation." >&2
					rm -rf "$DENO_INSTALL"
					exit 1  # 首次运行失败直接退出
				fi
			fi

			# 为 Deno.js 打补丁 (Termux)
			patch_deno
			touch "$AUTO_INSTALLED_DENO_FLAG" # 标记为自动安装
		else
			# 非 Termux 环境下的普通安装
			echo "Deno not found, attempting to install..."
			curl -fsSL https://deno.land/install.sh | sh -s -- -y
			if [ $? -ne 0 ]; then
				echo "Deno standard installation script failed. Attempting direct download to fount's path folder..."

				local deno_dl_url="https://github.com/denoland/deno/releases/latest/download/deno-"
				local arch_target=""
				local current_arch=$(uname -m)

				case "$OS_TYPE" in
					Linux*)
						# PWSH版本Linux默认x86_64，这里也遵循，除非明确需要其他架构
						arch_target="x86_64-unknown-linux-gnu.zip"
						if [ "$current_arch" = "aarch64" ]; then
							arch_target="aarch64-unknown-linux-gnu.zip"
						else
							arch_target="x86_64-unknown-linux-gnu.zip"
						fi
						;;
					Darwin*)
						if [ "$current_arch" = "arm64" ]; then
							arch_target="aarch64-apple-darwin.zip"
						else
							arch_target="x86_64-apple-darwin.zip"
						fi
						;;
					*)
						echo "Warning: Unknown OS type: $(uname -s). Defaulting to x86_64-unknown-linux-gnu.zip for manual download." >&2
						arch_target="x86_64-unknown-linux-gnu.zip"
						;;
				esac
				deno_dl_url="${deno_dl_url}${arch_target}"

				local TEMP_DIR="/tmp"
				mkdir -p "$FOUNT_DIR/path"

				if ! command -v unzip &> /dev/null; then
					echo "'unzip' command not found. Attempting to install..."
					install_package unzip
					if ! command -v unzip &> /dev/null; then
						echo "Error: Failed to install 'unzip'. Cannot proceed with Deno installation." >&2
						exit 1
					fi
				fi

				if ! curl -fL -o "$TEMP_DIR/deno.zip" "$deno_dl_url"; then
					echo "Error: Failed to download Deno from $deno_dl_url." >&2
					exit 1
				fi

				if ! unzip -o "$TEMP_DIR/deno.zip" -d "$FOUNT_DIR/path"; then
					echo "Error: Failed to extract Deno archive to $FOUNT_DIR/path." >&2
					rm "$TEMP_DIR/deno.zip"
					exit 1
				fi
				rm "$TEMP_DIR/deno.zip"

				chmod +x "$FOUNT_DIR/path/deno"
				export PATH="$PATH:$FOUNT_DIR/path"
			else
				# 处理 PATH 和 DENO_INSTALL 环境变量的持久化
				local profile_file_deno="$HOME/.profile"
				if [[ "$SHELL" == *"/zsh" ]]; then
					profile_file_deno="$HOME/.zshrc"
				elif [[ "$SHELL" == *"/bash" ]]; then
					profile_file_deno="$HOME/.bashrc"
				fi
				if [[ ! -f "$profile_file_deno" ]] && [[ -f "$HOME/.profile" ]]; then
					profile_file_deno="$HOME/.profile"
				elif [[ ! -f "$profile_file_deno" ]] && [[ ! -f "$HOME/.profile" ]]; then
					touch "$HOME/.profile"
					profile_file_deno="$HOME/.profile"
				fi
				source "$profile_file_deno" &> /dev/null # 重新加载 shell 配置文件以更新 PATH (当前会话)
				export DENO_INSTALL="$HOME/.deno"
				export PATH="$PATH:$DENO_INSTALL/bin"
				touch "$AUTO_INSTALLED_DENO_FLAG" # 标记为自动安装
			fi
		fi

		# 最终检查，如果还是找不到 Deno，则退出
		if ! command -v deno &> /dev/null; then
			echo "Error: Deno missing, you cannot run fount without deno." >&2
			exit 1
		fi
	fi
}

install_deno

# 函数: 升级 Deno
deno_upgrade() {
	# 使用 run_deno 来获取 Deno 版本信息
	local deno_version_before=$(run_deno -V 2>&1)
	local deno_upgrade_channel="stable"
	if [[ "$deno_version_before" == *"+"* ]]; then
		deno_upgrade_channel="canary"
	elif [[ "$deno_version_before" == *"-rc"* ]]; then
		deno_upgrade_channel="rc"
	fi
	if [[ -z "$deno_version_before" ]]; then
		echo "Error: Could not determine current Deno version. Skipping upgrade." >&2
	else
		run_deno upgrade -q "$deno_upgrade_channel"
		local upgrade_exit_code=$?
		# 若$upgrade_exit_code -ne 0且termux，删除并重装
		if [[ $upgrade_exit_code -ne 0 && $IN_TERMUX -eq 1 ]]; then
			rm -rf "$HOME/.deno"
			install_deno
			upgrade_exit_code=$?
		fi
		local deno_version_after=$(run_deno -V 2>&1)

		if [ $upgrade_exit_code -ne 0 ]; then
			echo "Warning: Deno upgrade may have failed. Please check for errors." >&2
		fi
	fi
}

# 如果不在 Docker 环境，则升级 Deno
if [ $IN_DOCKER -eq 1 ]; then
	echo "Skipping Deno upgrade in Docker environment"
else
	deno_upgrade
fi

# 输出 Deno 版本信息
echo "$(run_deno -V)"

# 函数: 运行 fount
run() {
	if [[ $(id -u) -eq 0 ]]; then
		echo "Warning: Not Recommended: Running fount as root grants full system access for all fount parts." >&2
		echo "Warning: Unless you know what you are doing, it is recommended to run fount as a common user." >&2
	fi

	# Termux 环境下设置 LANG
	if [[ $IN_TERMUX -eq 1 ]]; then
		LANG_BACKUP="$LANG"
		export LANG="$(getprop persist.sys.locale)"
		# 水秋脚本对termux的劫持移除
		local SQsacPath="/data/data/com.termux/files/usr/var/lib/proot-distro/installed-rootfs/ubuntu/root/.bashrc"
		if [[ -f "$SQsacPath" ]] && grep -q "bash /root/sac.sh" "$SQsacPath"; then
			sed -i '/bash \/root\/sac.sh/d' "$SQsacPath"
			sed -i '/proot-distro login ubuntu/d' "/data/data/com.termux/files/home/.bashrc"
		fi
	fi

	# 运行 fount (debug 或普通模式)
	if [[ $# -gt 0 && $1 = 'debug' ]]; then
		newargs=("${@:2}")
		run_deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" "${newargs[@]}"
	else
		run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" "$@"
	fi

	# 恢复 Termux LANG 设置
	if [[ $IN_TERMUX -eq 1 ]]; then
		export LANG="$LANG_BACKUP"
	fi
}

# 安装 fount 依赖
if [[ ! -d "$FOUNT_DIR/node_modules" || ($# -gt 0 && $1 = 'init') ]]; then
	if [[ -d "$FOUNT_DIR/node_modules" ]]; then
		run "shutdown"
	fi
	echo "Installing Fount dependencies..."
	set +e # 临时禁用严格模式，因为第一次运行可能会失败
	run_deno install --reload --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
	# 不知为何部分环境下第一次跑铁定出错，先跑再说 (模仿 PowerShell 脚本的行为)
	run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" "shutdown" 2>/dev/null || true
	set -e # 重新启用严格模式

	if [ $IN_DOCKER -eq 0 ] && [ $IN_TERMUX -eq 0 ]; then
		create_desktop_shortcut # 现在这个函数会同时处理快捷方式和协议注册
	fi

	echo "======================================================"
	echo "WARNING: DO NOT install any untrusted fount parts on your system, they can do ANYTHING."
	echo "======================================================"
fi

# 主要参数处理逻辑
if [[ $# -gt 0 ]]; then
	case "$1" in
		init)
			exit 0
			;;
		keepalive)
			runargs=("${@:2}")
			run "${runargs[@]}"
			# 如果 fount 退出码不为 0 (表示出错或需要重启)，则循环
			while [ $? -ne 0 ]; do
				echo "Fount exited with an error, attempting to upgrade and restart..." >&2
				deno_upgrade
				fount_upgrade
				run "${runargs[@]}"
			done
			;;
		remove)
			echo "Initiating fount uninstallation..."
			run shutdown # 尝试关闭 fount 进程

			# 1. 移除 fount PATH 条目
			echo "Removing fount PATH entries from shell profiles..."
			# 常见 profile 文件列表
			local profile_files=("$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc")
			for profile_file in "${profile_files[@]}"; do
				if [ -f "$profile_file" ]; then
					# macOS sed needs empty string, Linux sed doesn't
					if [ "$OS_TYPE" = "Darwin" ]; then
						sed -i '' '/export PATH="\$PATH:'"$ESCAPED_FOUNT_DIR\/path"'"/d' "$profile_file"
					else
						sed -i '/export PATH="\$PATH:'"$ESCAPED_FOUNT_DIR\/path"'"/d' "$profile_file"
					fi
					echo "Cleaned PATH entries in $profile_file."
				fi
			done
			# 从当前 PATH 环境变量中移除 fount 路径
			export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$FOUNT_DIR/path" | grep -v "$HOME/.deno/bin" | tr '\n' ':' | sed 's/:*$//') # Remove trailing colon
			echo "Fount path removed from current PATH."

			# 2. 移除桌面快捷方式和协议处理程序
			remove_desktop_shortcut

			# 3. 卸载 Termux Pacman 包 (如果适用)
			if [[ $IN_TERMUX -eq 1 ]]; then
				echo "Uninstalling Termux Pacman packages..."
				for package in "${INSTALLED_PACMAN_PACKAGES_ARRAY[@]}"; do
					pacman -R --noconfirm "$package"
				done
			fi

			# 4. 卸载自动安装的系统包
			echo "Uninstalling system packages..."
			# 重新加载列表以确保最新状态
			load_installed_packages
			for package in "${INSTALLED_SYSTEM_PACKAGES_ARRAY[@]}"; do
				uninstall_package "$package" || echo "Could not uninstall $package (might be manually installed or a core dependency)."
			done

			# 5. 卸载 Deno (如果自动安装)
			if [ -f "$AUTO_INSTALLED_DENO_FLAG" ]; then
				echo "Uninstalling Deno..."
				if [ -d "$HOME/.deno" ]; then
					rm -rf "$HOME/.deno"
					echo "Deno installation directory $HOME/.deno removed."
				fi
				for profile_file in "${profile_files[@]}"; do
					if [ -f "$profile_file" ]; then
						# macOS sed needs empty string, Linux sed doesn't
						if [ "$OS_TYPE" = "Darwin" ]; then
							sed -i '' '/\.deno/d' "$profile_file"
						else
							sed -i '/\.deno/d' "$profile_file"
						fi
						echo "Cleaned PATH entries in $profile_file."
					fi
				done
				rm -f "$AUTO_INSTALLED_DENO_FLAG"
			fi

			# 6. 移除 fount 安装目录
			if [ -d "$FOUNT_DIR" ]; then
				echo "Removing fount installation directory: $FOUNT_DIR"
				rm -rf "$FOUNT_DIR"
			else
				echo "Fount installation directory $FOUNT_DIR not found."
			fi

			echo "Fount uninstallation complete."
			exit 0
			;;
		*)
			# 默认运行 fount
			run "$@"
			;;
	esac
else
	# 没有参数时默认运行 fount
	run "$@"
fi

exit $?
