#!/bin/bash

install_package() {
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
	fi
	return 0
}

if ! command -v fount.sh &> /dev/null; then
	if [ -f "$HOME/.profile" ]; then
		if ! grep -q "export PATH=\"\$PATH:$FOUNT_DIR/path\"" "$HOME/.profile"; then
			echo "export PATH=\"\$PATH:$FOUNT_DIR/path\"" >> "$HOME/.profile"
		fi
	else
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
	echo "Git is not installed, attempting to install..."
	install_package git  # Use the install_package function
fi

fount_upgrade() {
	if ! command -v git &> /dev/null; then # Ensure git is now installed
		echo "Git is not installed, skipping fount update"
		return 0
	fi
	if [ ! -d "$FOUNT_DIR/.git" ]; then
		rm -rf "$FOUNT_DIR/.git-clone"  # Remove any old .git-clone
		mkdir -p "$FOUNT_DIR/.git-clone"
		git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1
		if [ $? -ne 0 ]; then
			echo "Error: Failed to clone fount repository.  Check connection/config." >&2
			exit 1
		fi
		mv "$FOUNT_DIR/.git-clone/.git" "$FOUNT_DIR/.git"
		rm -rf "$FOUNT_DIR/.git-clone"
		git -C "$FOUNT_DIR" fetch origin
		git -C "$FOUNT_DIR" clean -fd
		git -C "$FOUNT_DIR" reset --hard "origin/master"
		git -C "$FOUNT_DIR" checkout master
	else
		# Repository exists:  Update logic
		if [ ! -d "$FOUNT_DIR/.git" ]; then # Double check if the repo exists
			echo "Repository not found at $FOUNT_DIR/.git, skipping git pull." >&2
		else
			# Fetch latest changes
			git -C "$FOUNT_DIR" fetch origin

			# Get current branch name
			currentBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD)

			# Handle detached HEAD (like PowerShell script)
			if [ "$currentBranch" = "HEAD" ]; then
				echo "Not on a branch, switching to 'master'..."
				git -C "$FOUNT_DIR" clean -fd
				git -C "$FOUNT_DIR" reset --hard "origin/master"
				git -C "$FOUNT_DIR" checkout master
				currentBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD) # Re-read
			fi

			# Get upstream branch (if any)
			remoteBranch=$(git -C "$FOUNT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)

			# If no upstream branch, set it to origin/master
			if [ -z "$remoteBranch" ]; then
				echo "Warning: No upstream branch for '$currentBranch'. Setting to origin/master." >&2
				git -C "$FOUNT_DIR" branch --set-upstream-to origin/master "$currentBranch"
				remoteBranch="origin/master" # Set for consistency
			fi

			# Check for uncommitted changes
			status=$(git -C "$FOUNT_DIR" status --porcelain)
			if [ -n "$status" ]; then
				echo "Warning: Uncommitted changes. Stash or commit before updating." >&2
			fi

			# Get merge base, local commit, and remote commit
			mergeBase=$(git -C "$FOUNT_DIR" merge-base "$currentBranch" "$remoteBranch")
			localCommit=$(git -C "$FOUNT_DIR" rev-parse "$currentBranch")
			remoteCommit=$(git -C "$FOUNT_DIR" rev-parse "$remoteBranch")

			# Compare commits and update accordingly
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
if [ -f "$FOUNT_DIR/.noupdate" ]; then
	echo "Skipping fount update due to .noupdate file"
else
	fount_upgrade
fi

if [[ ($IN_TERMUX -eq 0 && -z "$(command -v deno)") || ($IN_TERMUX -eq 1 && ! -f ~/.deno/bin/deno.glibc.sh) ]]; then
	if [[ $IN_TERMUX -eq 1 ]]; then
		echo "Installing Deno for Termux..."
		# Termux 环境下的特殊处理
		set -e
		yes y | pkg upgrade -y
		pkg install -y pacman patchelf which time ldd tree

		# 安装 glibc-runner, bash, patchelf, resolv-conf - 检查是否已安装 glibc-runner
		if ! command -v glibc-runner &> /dev/null; then
			# 初始化和更新 pacman
			pacman-key --init
			pacman-key --populate
			pacman -Syu --noconfirm

			pacman -Sy glibc-runner --assume-installed bash,patchelf,resolv-conf --noconfirm
		fi
		set +e

		# Install Deno.js
		curl -fsSL https://deno.land/install.sh | sh -s -- -y
		DENO_INSTALL="${HOME}/.deno"
		DENO_BIN_PATH="${DENO_INSTALL}/bin/deno"

		# Explicitly set execute permissions
		chmod +x "$DENO_BIN_PATH"

		# Source bashrc and PATH setup  (提前 source)
		export DENO_INSTALL="${HOME}/.deno"
		export PATH="${PATH}:${DENO_INSTALL}/bin"

		# 将 Deno 添加到 .profile (如果尚不存在)  <--- 修改为 .profile
		if ! grep -q "export PATH=.*${DENO_INSTALL}/bin" "$HOME/.profile"; then
			echo "export PATH=\"\$PATH:${DENO_INSTALL}/bin\"" >> "$HOME/.profile"
		fi
		source "$HOME/.profile"
		if [[ "$SHELL" == *"/zsh" ]]; then
			source "$HOME/.zshrc"
		else
			source "$HOME/.bashrc"
		fi

		# 尝试使用 glibc-runner 运行 Deno，使用绝对路径(在source之后)
		GLIBC_RUNNER_PATH=$(which glibc-runner)
		if ! "$GLIBC_RUNNER_PATH" "$DENO_BIN_PATH" -V &> /dev/null; then
			echo "Error: Deno failed to execute with glibc-runner." >&2
			rm -rf "$DENO_INSTALL"
			exit 1  # 首次运行失败直接退出
		fi

		# Check 'command -v deno' again (after direct execution and PATH setup)
		if ! command -v deno &> /dev/null; then
			echo "Warning: 'deno' command not found in PATH." >&2
			# 不退出，因为后面可能通过 wrapper 运行
		fi

		# Patch Deno.js (Termux)
		patch_deno

		echo "Deno installed for Termux."

	else
		# 非 Termux 环境下的普通安装
		curl -fsSL https://deno.land/install.sh | sh -s -- -y
		source "$HOME/.profile"
		if [[ "$SHELL" == *"/zsh" ]]; then
			source "$HOME/.zshrc"
		else
			source "$HOME/.bashrc"
		fi
	fi

	if ! command -v deno &> /dev/null; then
		echo "Deno missing, you cant run fount without deno (final check)"
		exit 1  # 最终检查，如果还是找不到，则退出
	fi
fi


deno_upgrade() {
	# 使用 run_deno 来获取 Deno 版本信息
	deno_version_before=$(run_deno -V 2>&1)
	deno_upgrade_channel="stable"
	if [[ "$deno_version_before" == *"+"* ]]; then
		deno_upgrade_channel="canary"
	elif [[ "$deno_version_before" == *"-rc"* ]]; then
		deno_upgrade_channel="rc"
	fi
	if [[ -z "$deno_version_before" ]]; then
		echo "Error: Could not determine current Deno version." >&2
	else
		run_deno upgrade -q $deno_upgrade_channel
		deno_version_after=$(run_deno -V 2>&1)

		# 检查是否需要重新 patch deno
		if [[ "$deno_version_before" != "$deno_version_after" && $IN_TERMUX -eq 1 ]]; then
			patch_deno
		fi
	fi
}
if [ $IN_DOCKER -eq 1 ]; then
	echo "Skipping deno upgrade in Docker environment"
else
	deno_upgrade
fi

# 使用 run_deno 来获取 Deno 版本信息，并输出
run_deno -V

if [[ ! -d "$FOUNT_DIR/node_modules" || ($# -gt 0 && $1 = 'init') ]]; then
	echo "Installing dependencies..."
	set +e
	run_deno install --reload --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
	# 不知为何部分环境下第一次跑铁定出错，先跑再说
	run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" "shutdown"
	set -e
	echo "======================================================"
	echo "WARNING: DO NOT install any untrusted fount parts on your system, they can do ANYTHING."
	echo "======================================================"
fi

run() {
	if [[ $(id -u) -eq 0 ]]; then
		echo "Not recommended: Running fount as root grants full system access for all fount parts."
		echo "Unless you know what you are doing, it is recommended to run fount as a common user."
	fi
	if [[ $IN_TERMUX -eq 1 ]]; then
		LANG_BACKUP="$LANG"
		export LANG="$(getprop persist.sys.locale)"
	fi
	if [[ $# -gt 0 && $1 = 'debug' ]]; then
		newargs=("${@:2}")
		run_deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" "${newargs[@]}"
	else
		run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" "$@"
	fi
	if [[ $IN_TERMUX -eq 1 ]]; then
		export LANG="$LANG_BACKUP"
	fi
}
if [[ $# -gt 0 && $1 = 'init' ]]; then
	exit 0
elif [[ $# -gt 0 && $1 = 'keepalive' ]]; then
	runargs=("${@:2}")
	run "${runargs[@]}"
	while $?; do
		deno_upgrade
		fount_upgrade
		run
	done
elif [[ $# -gt 0 && $1 = 'remove' ]]; then
	run shutdown
	echo "removing fount..."

	# Remove fount from PATH in .profile
	if [ -f "$HOME/.profile" ]; then
		sed -i '/export PATH="\$PATH:'"$FOUNT_DIR/path"'"/d' "$HOME/.profile"
	fi

	# Remove fount from current PATH
	export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "$FOUNT_DIR/path" | tr '\n' ':')

	# Remove fount installation directory
	rm -rf "$FOUNT_DIR"

	echo "fount uninstallation complete."
	exit 0
else
	run "$@"
fi

exit $?
