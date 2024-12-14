#!/bin/bash

# 若是 Windows 环境，则使用 fount.ps1
if [[ "$OSTYPE" == "msys" ]]; then
	powerShell.exe -noprofile -executionpolicy bypass -command "{
	\$env:FOUNT_DIR = '$FOUNT_DIR' # 空字符串也是假 所以不需要空判断
	irm https://raw.githubusercontent.com/steve02081504/fount/refs/heads/master/src/runner/main.ps1 | iex
	}" $@
	exit $?
fi

# 若未定义，则默认 fount 安装目录
FOUNT_DIR="${$FOUNT_DIR:-"$HOME/.local/share/fount"}"

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
else
	# fount.sh 已存在，获取其所在目录
	FOUNT_DIR="$(dirname "$(dirname "$(command -v fount.sh)")")"
fi

# 执行 fount.sh 脚本
"$FOUNT_DIR/path/fount.sh" $@
