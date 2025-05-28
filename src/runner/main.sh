#!/bin/bash

# 若是 Windows 环境，则使用 fount.ps1
if [[ "$OSTYPE" == "msys" ]]; then
	powerShell.exe -noprofile -executionpolicy bypass -command "{
	\$env:FOUNT_DIR = '$FOUNT_DIR' # 空字符串也是假 所以不需要空判断
	irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
	}" $@
	exit $?
fi

INSTALLED_PACKAGES=""

install_package() {
	# 将当前安装的包添加到列表中
	if [[ -z "$INSTALLED_PACKAGES" ]]; then
		INSTALLED_PACKAGES="$1"
	else
		INSTALLED_PACKAGES="$INSTALLED_PACKAGES;$1"
	fi

	if command -v pkg &> /dev/null; then
		pkg install -y "$1"
	elif command -v apt-get &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo apt-get update
			sudo apt-get install -y "$1"
		else
			apt-get update
			apt-get install -y "$1"
		fi
	elif command -v brew &> /dev/null; then
		brew install "$1"
		eval "$(brew shellenv)" || eval "$(/opt/homebrew/bin/brew shellenv)"
	elif command -v pacman &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo pacman -Syy
			sudo pacman -S --needed --noconfirm "$1"
		else
			pacman -Syy
			pacman -S --needed --noconfirm "$1"
		fi
	elif command -v dnf &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo dnf install -y "$1"
		else
			dnf install -y "$1"
		fi
	elif command -v zypper &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo zypper install -y --no-confirm "$1"
		else
			zypper install -y --no-confirm "$1"
		fi
	elif command -v apk &> /dev/null; then
		apk add --update "$1"
	else
		echo "无法安装 $1"
		exit 1
	fi
}

# 检查依赖
if ! command -v git &> /dev/null; then
	install_package git
fi
if ! command -v unzip &> /dev/null; then
	install_package unzip
fi
if ! command -v wget &> /dev/null; then
	install_package wget
fi

# 若未定义，则默认 fount 安装目录
FOUNT_DIR="${FOUNT_DIR:-"$HOME/.local/share/fount"}"

# 检查 fount.sh 是否已存在
if ! command -v fount.sh &> /dev/null; then
	# 清理旧的 fount 安装（如果存在）
	rm -rf "$FOUNT_DIR"

	# 尝试使用 git 克隆
	if command -v git &> /dev/null; then
		git clone https://github.com/steve02081504/fount "$FOUNT_DIR" --depth 1
		if [[ $? -ne 0 ]]; then
			echo "下载错误，终止脚本" >&2
			exit 1
		fi
	else
		# 使用 wget 和 unzip 下载
		rm -rf /tmp/fount-master
		wget -O /tmp/fount.zip https://github.com/steve02081504/fount/archive/refs/heads/master.zip
		if [[ $? -ne 0 ]]; then
			echo "下载错误，终止脚本" >&2
			exit 1
		fi
		unzip -o /tmp/fount.zip -d /tmp
		if [[ $? -ne 0 ]]; then
			echo "解压错误，可能需要安装 unzip , 可以尝试执行：sudo apt-get install unzip" >&2
			exit 1
		fi
		rm /tmp/fount.zip
		# 保证父目录存在
		mkdir -p "$FOUNT_DIR"
		mv /tmp/fount-master "$FOUNT_DIR"
	fi
	# 移除隔离属性 (仅限 macOS)
	if [[ "$OSTYPE" == "darwin"* ]]; then
		xattr -dr com.apple.quarantine "$FOUNT_DIR"
	fi
	find "$FOUNT_DIR" -name "*.sh" -exec chmod +x {} \;
	find "$FOUNT_DIR/path" -type f -exec chmod +x {} \;
else
	# fount.sh 已存在，获取其所在目录
	FOUNT_DIR="$(dirname "$(dirname "$(command -v fount.sh)")")"
fi

if [[ -n "$INSTALLED_PACKAGES" ]]; then
	INSTALLER_DATA_DIR="$FOUNT_DIR/data/installer"
	mkdir -p "$INSTALLER_DATA_DIR"
	echo "$INSTALLED_PACKAGES" > "$INSTALLER_DATA_DIR/auto_installed_system_packages"
fi

# 执行 fount.sh 脚本
"$FOUNT_DIR/path/fount.sh" $@
