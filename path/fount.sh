#!/bin/bash

install_package() {
	if command -v apt-get &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo apt-get update
			sudo apt-get install -y "$1"
		else
			apt-get update
			apt-get install -y "$1"
		fi
	elif command -v brew &> /dev/null; then
		brew install "$1"
	elif command -v pacman &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo pacman -Syy
			sudo pacman -S --needed "$1"
		else
			pacman -Syy
			pacman -S --needed "$1"
		fi
	elif command -v dnf &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo dnf install -y "$1"
		else
			dnf install -y "$1"
		fi
	elif command -v zypper &> /dev/null; then
		if command -v sudo &> /dev/null; then
			sudo zypper install -y "$1"
		else
			zypper install -y "$1"
		fi
	elif command -v apk &> /dev/null; then
		apk add --update "$1"
	else
		echo "无法安装 $1"
		exit 1
	fi
}

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
FOUNT_DIR=$(dirname "$SCRIPT_DIR")
IN_DOCKER=0
if [ -f "/.dockerenv" ] || grep -q 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
	IN_DOCKER=1
fi

if ! command -v fount &> /dev/null; then
	if ! grep -q "export PATH=\"\$PATH:$FOUNT_DIR/path\"" "$HOME/.bashrc"; then
		echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >> "$HOME/.bashrc"
	fi
	export PATH="$PATH:$FOUNT_DIR/path"
fi

if ! command -v git &> /dev/null; then
	install_package git
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
	if [ $IN_DOCKER -eq 1 ]; then
		echo "Skipping git pull in Docker environment"
	else
		git -C "$FOUNT_DIR" pull -f
	fi
else
	echo "Git is not installed, skipping git pull"
fi

if ! command -v deno &> /dev/null; then
	if [[ -d "/data/data/com.termux" ]]; then
		# Termux 环境下的特殊处理
		pkg install pacman patchelf which time ldd tree

		# 初始化和更新 pacman
		pacman-key --init
		pacman-key --populate
		pacman -Syu

		# 安装 glibc-runner
		pacman -Sy glibc-runner --assume-installed bash,patchelf,resolv-conf

		# 安装 Deno.js
		curl -fsSL https://deno.land/install.sh | sh -s -- -y

		# 设置环境变量
		export DENO_INSTALL="${HOME}/.deno"
		export PATH="${PATH}:${DENO_INSTALL}/bin"

		# Patch Deno.js
		patchelf --set-rpath "${PREFIX}/glibc/lib" --set-interpreter "${PREFIX}/glibc/lib/ld-linux-aarch64.so.1" "$(which deno)"

		# 创建包装脚本
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
	else
		# 非 Termux 环境下的普通安装
		curl -fsSL https://deno.land/install.sh | sh -s -- -y
		if [[ "$SHELL" == *"/zsh" ]]; then
			source "$HOME/.zshrc"
		else
			source "$HOME/.bashrc"
		fi
	fi
	if ! command -v deno &> /dev/null; then
		echo "Deno missing, you cant run fount without deno"
		exit 1
	else
		echo "Deno installed"
	fi
fi

if [ $IN_DOCKER -eq 1 ]; then
	echo "Skipping deno upgrade in Docker environment"
else
	deno upgrade -q
fi
deno -V
if [[ ! -d "$FOUNT_DIR/node_modules" || ($# -gt 0 && $1 = 'init') ]]; then
	echo "Installing dependencies..."
	deno install --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
fi

run() {
	if [[ $# -gt 0 && $1 = 'debug' ]]; then
		newargs=($@[1:])
		deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" @newargs
	else
		deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" $@
	fi
}
if [[ $# -gt 0 && $1 = 'init' ]]; then
	exit 0
elif [[ $# -gt 0 && $1 = 'keepalive' ]]; then
	runargs=($@[1:])
	while true; do run @runargs; done
else
	run $@
fi
