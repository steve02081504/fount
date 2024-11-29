#!/bin/bash

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
FOUNT_DIR=$(dirname "$SCRIPT_DIR")

if ! command -v fount &> /dev/null; then
	if ! grep -q "export PATH=\"\$PATH:$FOUNT_DIR/path\"" "$HOME/.bashrc"; then
		echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >> "$HOME/.bashrc"
	fi
	export PATH="$PATH:$FOUNT_DIR/path"
fi

if ! command -v git &> /dev/null; then
	if command -v apt-get &> /dev/null; then
		sudo apt-get update
		sudo apt-get install -y git
	elif command -v brew &> /dev/null; then
		brew install git
	elif command -v pacman &> /dev/null; then
		sudo pacman -Syy
		sudo pacman -S --needed git
	elif command -v dnf &> /dev/null; then
		sudo dnf install -y git
	elif command -v zypper &> /dev/null; then
		sudo zypper install -y git
	else
		echo "git could not be found"
		exit 1
	fi
fi
if command -v git &> /dev/null; then
	if [ ! -d "$FOUNT_DIR/.git" ]; then
		rm -rf "$FOUNT_DIR/.git-clone"
		mkdir -p "$FOUNT_DIR/.git-clone"
		git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1
		mv "$FOUNT_DIR/.git-clone/.git" "$FOUNT_DIR/.git"
		rm -rf "$FOUNT_DIR/.git-clone"
		git -C "$FOUNT_DIR" fetch origin
		git -C "$FOUNT_DIR" reset --hard origin/master
		git -C "$FOUNT_DIR" checkout origin/master
	fi
	git -C "$FOUNT_DIR" pull
else
	echo "Git is not installed, skipping git pull"
fi

if ! command -v bun &> /dev/null; then
	if [[ -d "/data/data/com.termux" ]]; then
		# Termux 环境下的特殊处理
		pkg install pacman patchelf which time ldd tree

		# 初始化和更新 pacman
		pacman-key --init
		pacman-key --populate
		pacman -Syu

		# 安装 glibc-runner
		pacman -Sy glibc-runner --assume-installed bash,patchelf,resolv-conf

		# 安装 Bun
		curl -fsSL https://bun.sh/install | bash

		# 设置环境变量
		export BUN_INSTALL="$HOME/.bun"
		export PATH="${PATH}:${BUN_INSTALL}/bin"

		# 检查并修补 Bun
		patchelf --print-interpreter --print-needed "$(which bun)"
		patchelf --set-rpath "${PREFIX}/glibc/lib" --set-interpreter "${PREFIX}/glibc/lib/ld-linux-aarch64.so.1" "$(which bun)"
		ldd "$(which bun)"

		# 创建包装脚本
		cat > ~/.bun/bin/bun.glibc.sh << 'EOF'
#!/usr/bin/env sh
_oldpwd="${PWD}"
_dir="$(dirname "${0}")"
cd "${_dir}"
if ! [ -h "bun" ] ; then
  >&2 mv -fv "bun" "bun.orig"
  >&2 ln -sfv "bun.glibc.sh" "bun"
fi
cd "${_oldpwd}"
LD_PRELOAD= exec "${_dir}/bun.orig" "${@}"
EOF

		chmod u+x ~/.bun/bin/bun.glibc.sh
	else
		# 非 Termux 环境下的普通安装
		curl -fsSL https://bun.sh/install | sh
	fi
	if ! command -v deno &> /dev/null; then
		echo "Deno missing, you cant run fount without deno"
		exit 1
	fi
fi

if [ $# -gt 0 -a $1 = 'debug' ]; then
	newargs=($@[1:])
	bun run --inspect-brk "$FOUNT_DIR/src/server/index.mjs" @newargs
else
	bun run "$FOUNT_DIR/src/server/index.mjs" $@
fi
