#!/bin/bash

install_package() {
	if command -v pkg &> /dev/null; then
		pkg install "$1"
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

SCRIPT_DIR=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
FOUNT_DIR=$(dirname "$SCRIPT_DIR")
IN_DOCKER=0
if [ -f "/.dockerenv" ] || grep -q 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
	IN_DOCKER=1
fi
IN_TERMUX=0
if [[ -d "/data/data/com.termux" ]]; then
	IN_TERMUX=1
fi

# Function to run deno, considering glibc-runner if available, and .glibc.sh wrapper
run_deno() {
	local deno_args=("$@")
	local deno_cmd="deno"  # Default

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

# Function to patch the deno executable for Termux
patch_deno() {
	local deno_bin=$(which deno)

	if [[ -z "$deno_bin" ]]; then
		echo "Error: Deno executable not found before patching. Cannot patch." >&2
		return 1
	fi

	if ! command -v patchelf &> /dev/null; then
		echo "patchelf is not installed. Please install it."
		return 1
	fi

	# 使用更通用的 rpath 和正确的 interpreter 路径
	patchelf --set-rpath '${ORIGIN}/../glibc/lib' --set-interpreter "${PREFIX}/glibc/lib/ld-linux-aarch64.so.1" "$deno_bin"

	if [ $? -ne 0 ]; then
		echo "Error: Failed to patch Deno executable with patchelf." >&2
		return 1
	else
		echo "Deno executable patched successfully."
		# Create wrapper script (Termux)
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
		echo "Deno wrapper script created."
	fi
	return 0
}


if [[ $# -gt 0 && $1 = 'remove' ]]; then
	echo "removing fount..."

	# Remove fount from PATH in .profile
	echo "removing fount from PATH in .profile..."
	if [ -f "$HOME/.profile" ]; then
		sed -i '/export PATH="\$PATH:'"$FOUNT_DIR/path"'"/d' "$HOME/.profile"
		echo "fount removed from PATH in .profile."
	else
		echo ".profile not found, skipping PATH removal from .profile."
	fi

	# Remove fount from current PATH
	echo "removing fount from current PATH..."
	export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$FOUNT_DIR/path" | tr '\n' ':')
	echo "fount removed from current PATH."

	# Remove fount installation directory
	echo "removing fount installation directory..."
	rm -rf "$FOUNT_DIR"
	echo "fount installation directory removed."

	echo "fount uninstallation complete."
	exit 0
fi

if ! command -v fount.sh &> /dev/null; then
	if [ -f "$HOME/.profile" ]; then
		if ! grep -q "export PATH=\"\$PATH:$FOUNT_DIR/path\"" "$HOME/.profile"; then
			echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >> "$HOME/.profile"
			echo "fount added to PATH in .profile."
		else
			echo "fount already in PATH in .profile."
		fi
	else
		echo ".profile not found, creating and adding fount to PATH in .profile."
		echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >> "$HOME/.profile"
	fi
	export PATH="$PATH:$FOUNT_DIR/path"
fi

if [[ $# -gt 0 && $1 = 'background' ]]; then
	if command -v fount.sh &> /dev/null; then
		nohup fount.sh "${@:2}" > /dev/null 2>&1 &
		exit 0
	else
		echo "this script requires fount installed"
		exit 1
	fi
fi

if ! command -v git &> /dev/null; then
	install_package git
fi

if command -v git &> /dev/null; then
	if [ ! -d "$FOUNT_DIR/.git" ]; then
		echo "Cloning fount repository..."
		rm -rf "$FOUNT_DIR/.git-clone"
		mkdir -p "$FOUNT_DIR/.git-clone"
		git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1
		if [ $? -ne 0 ]; then
			echo "Error: Failed to clone fount repository. Please check your internet connection or git configuration."
			exit 1
		fi
		mv "$FOUNT_DIR/.git-clone/.git" "$FOUNT_DIR/.git"
		rm -rf "$FOUNT_DIR/.git-clone"
		git -C "$FOUNT_DIR" fetch origin
		git -C "$FOUNT_DIR" reset --hard "origin/master"
	fi

	if [ $IN_DOCKER -eq 1 ]; then
		echo "Skipping git pull in Docker environment"
	else
		currentBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD)
		remoteBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
		if [ -z "$remoteBranch" ]; then
			echo "Warning: No upstream branch configured for '$currentBranch'. Skipping update check." >&2
		else
			mergeBase=$(git -C "$FOUNT_DIR" merge-base "$currentBranch" "$remoteBranch")
			localCommit=$(git -C "$FOUNT_DIR" rev-parse "$currentBranch")
			remoteCommit=$(git -C "$FOUNT_DIR" rev-parse "$remoteBranch")
			status=$(git -C "$FOUNT_DIR" status --porcelain)

			if [ -n "$status" ]; then
				echo "Warning: Working directory is not clean. Stash or commit your changes before updating." >&2
			fi

			if [ "$localCommit" != "$remoteCommit" ]; then
				if [ "$mergeBase" = "$localCommit" ]; then
					echo "Updating from remote repository..."
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
else
	echo "Git is not installed, skipping git pull"
fi

if [[ ($IN_TERMUX -eq 0 && -z "$(command -v deno)") || ($IN_TERMUX -eq 1 && ! -f ~/.deno/bin/deno.glibc.sh) ]]; then
	if [[ $IN_TERMUX -eq 1 ]]; then
		echo "Termux environment detected, installing Deno for Termux..."
		# Termux 环境下的特殊处理
		pkg install -y pacman patchelf which time ldd tree

		# 初始化和更新 pacman
		pacman-key --init
		pacman-key --populate
		pacman -Syu --noconfirm

		# 安装 glibc-runner, bash, patchelf, resolv-conf - 检查是否已安装 glibc-runner
		if ! command -v glibc-runner &> /dev/null; then
			echo "glibc-runner not found, installing..."
			pacman -Sy glibc-runner --assume-installed bash,patchelf,resolv-conf --noconfirm
		else
			echo "glibc-runner already installed, skipping reinstallation."
		fi

		# Install Deno.js
		curl -fsSL https://deno.land/install.sh | sh -s -- -y
		DENO_INSTALL="${HOME}/.deno"
		DENO_BIN_PATH="${DENO_INSTALL}/bin/deno"

		# Check permissions *before* chmod
		echo "Permissions before chmod:"
		ls -l "$DENO_BIN_PATH" || echo "ls -l failed (file might not exist yet)"

		# Explicitly set execute permissions
		chmod +x "$DENO_BIN_PATH"
		echo "chmod +x '$DENO_BIN_PATH' executed."

		# Check permissions *after* chmod
		echo "Permissions after chmod:"
		ls -l "$DENO_BIN_PATH"


		# Source bashrc and PATH setup  (提前 source)
		export DENO_INSTALL="${HOME}/.deno"
		export PATH="${PATH}:${DENO_INSTALL}/bin"

		# 将 Deno 添加到 .profile (如果尚不存在)  <--- 修改为 .profile
		if ! grep -q "export PATH=.*${DENO_INSTALL}/bin" "$HOME/.profile"; then
			echo "export PATH=\"\$PATH:${DENO_INSTALL}/bin\"" >> "$HOME/.profile"
			echo "Added Deno to .profile."
		fi
		source "$HOME/.profile"

		# 尝试使用 glibc-runner 运行 Deno，使用绝对路径(在source之后)
		GLIBC_RUNNER_PATH=$(which glibc-runner)
		if "$GLIBC_RUNNER_PATH" "$DENO_BIN_PATH" -V &> /dev/null; then
			echo "Deno executed successfully with glibc-runner."
		else
		echo "Error: Deno failed to execute with glibc-runner." >&2
		exit 1  # 首次运行失败直接退出
		fi

		# Check 'command -v deno' again (after direct execution and PATH setup)
		if command -v deno &> /dev/null; then
			echo "Deno command found in PATH."
			echo "Deno installed to $(which deno)"
		else
			echo "Warning: 'deno' command not found in PATH." >&2
			# 不退出，因为后面可能通过 wrapper 运行
		fi



		# Patch Deno.js (Termux)
		if patch_deno; then
			# Create wrapper script moved to patch_deno
			echo "Deno patched and wrapper created."
		else
			echo "Warning: Deno patching failed, fount might not work in Termux." >&2
		fi

		echo "Deno installed and configured for Termux."

	else
		# 非 Termux 环境下的普通安装
		curl -fsSL https://deno.land/install.sh | sh -s -- -y
		if [[ "$SHELL" == *"/zsh" ]]; then
			source "$HOME/.zshrc"
		else
			source "$HOME/.bashrc"
		fi
		echo "Deno installed."
	fi

	if ! command -v deno &> /dev/null; then
		echo "Deno missing, you cant run fount without deno (final check)"
		exit 1  # 最终检查，如果还是找不到，则退出
	else
		echo "Deno installation verified (final check)."
	fi
fi


if [ $IN_DOCKER -eq 1 ]; then
	echo "Skipping deno upgrade in Docker environment"
else
	# 使用 run_deno 来获取 Deno 版本信息
	deno_version_before=$(run_deno -V 2>&1)
	if [[ -z "$deno_version_before" ]]; then
		echo "Error: Could not determine current Deno version." >&2
	else
		run_deno upgrade -q
		deno_version_after=$(run_deno -V 2>&1)

		# 检查是否需要重新 patch deno
		if [[ "$deno_version_before" != "$deno_version_after" && $IN_TERMUX -eq 1 ]]; then
			echo "Deno upgraded. Repatching..."
			patch_deno
		fi
	fi
fi

# 使用 run_deno 来获取 Deno 版本信息，并输出
run_deno -V

if [[ ! -d "$FOUNT_DIR/node_modules" || ($# -gt 0 && $1 = 'init') ]]; then
	echo "Installing dependencies..."
	run_deno install --reload --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs" || true
fi

run() {
	if [[ $# -gt 0 && $1 = 'debug' ]]; then
		newargs=("${@:2}")
		run_deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" "${newargs[@]}"
	else
		run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" "$@"
	fi
}
if [[ $# -gt 0 && $1 = 'init' ]]; then
	exit 0
elif [[ $# -gt 0 && $1 = 'keepalive' ]]; then
	runargs=("${@:2}")
	run "${runargs[@]}"
	while $?; do run; done
else
	run "$@"
fi

exit $?
