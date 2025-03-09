#!/usr/bin/env fish

function install_package
	if type -q pkg
		pkg install -y $argv
	else if type -q apt-get
		if type -q sudo
			sudo apt-get update
			sudo apt-get install -y $argv
		else
			apt-get update
			apt-get install -y $argv
		end
	else if type -q brew
		brew install $argv
	else if type -q pacman
		if type -q sudo
			sudo pacman -Syy
			sudo pacman -S --needed --noconfirm $argv
		else
			pacman -Syy
			pacman -S --needed --noconfirm $argv
		end
	else if type -q dnf
		if type -q sudo
			sudo dnf install -y $argv
		else
			dnf install -y $argv
		end
	else if type -q zypper
		if type -q sudo
			sudo zypper install -y --no-confirm $argv
		else
			zypper install -y --no-confirm $argv
		end
	else if type -q apk
		apk add --update $argv
	else
		echo "无法安装 $argv"
		exit 1
	end
end

set SCRIPT_DIR (dirname (realpath $argv[0]))
set FOUNT_DIR (dirname $SCRIPT_DIR)
set IN_DOCKER 0
if test -f "/.dockerenv" -o (grep -q 'docker\|containerd' /proc/1/cgroup)
	set IN_DOCKER 1
end
set IN_TERMUX 0
if test -d "/data/data/com.termux"
	set IN_TERMUX 1
end

function run_deno
	set deno_args $argv
	set deno_cmd "deno"  # Default

	if test $IN_TERMUX -eq 1
		if type -q deno.glibc.sh
			set deno_cmd "deno.glibc.sh"
		else if type -q glibc-runner
			set deno_cmd "glibc-runner (which deno)"
		else
			echo "Warning: glibc-runner and deno.glibc.sh not found, falling back to plain deno in Termux (may not work)." >&2
		end
	end
	exec $deno_cmd $deno_args
end

function patch_deno
	set deno_bin (which deno)

	if test -z "$deno_bin"
		echo "Error: Deno executable not found before patching. Cannot patch." >&2
		return 1
	end

	if not type -q patchelf
		echo "patchelf is not installed. Please install it."
		return 1
	end

	# 使用更通用的 rpath 和正确的 interpreter 路径
	patchelf --set-rpath '${ORIGIN}/../glibc/lib' --set-interpreter "${PREFIX}/glibc/lib/ld-linux-aarch64.so.1" $deno_bin

	if test $status -ne 0
		echo "Error: Failed to patch Deno executable with patchelf." >&2
		return 1
	else
		# Create wrapper script (Termux)
		mkdir -p ~/.deno/bin
		echo '#!/usr/bin/env sh
_oldpwd="${PWD}"
_dir="$(dirname "${0}")"
cd "${_dir}"
if not test -h "deno"
	mv -f "deno" "deno.orig"
	ln -sf "deno.glibc.sh" "deno"
end
cd "${_oldpwd}"
LD_PRELOAD= exec "${_dir}/deno.orig" $argv' > ~/.deno/bin/deno.glibc.sh
		chmod u+x ~/.deno/bin/deno.glibc.sh
	end
	return 0
end

if not type -q git
	echo "Git is not installed, attempting to install..."
	install_package git
end

# 2. Git Initialization / Update
if type -q git # Ensure Git is installed
	if not test -d "$FOUNT_DIR/.git"
		rm -rf "$FOUNT_DIR/.git-clone"
		mkdir -p "$FOUNT_DIR/.git-clone"
		git clone https://github.com/steve02081504/fount.git "$FOUNT_DIR/.git-clone" --no-checkout --depth 1
		if test $status -ne 0
			echo "Error: Failed to clone fount repository. Check connection/config." >&2
			exit 1
		end
		mv "$FOUNT_DIR/.git-clone/.git" "$FOUNT_DIR/.git"
		rm -rf "$FOUNT_DIR/.git-clone"
		git -C "$FOUNT_DIR" fetch origin
		git -C "$FOUNT_DIR" reset --hard "origin/master"
	else
		# Repository exists:  Update logic
		if test $IN_DOCKER -eq 1
			echo "Skipping git pull in Docker environment"
		else if not test -d "$FOUNT_DIR/.git"
			echo "Repository not found, skipping git pull"
		else
			git -C "$FOUNT_DIR" fetch origin

			set currentBranch (git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD)

			if test "$currentBranch" = "HEAD"
				echo "Not on a branch, switching to 'master'..."
				git -C "$FOUNT_DIR" checkout master
				set currentBranch (git -C "$FOUNT_DIR" rev-parse --abbrev-ref HEAD)
			end

			set -l remoteBranch ""
			set -l remoteBranchOutput (git -C "$FOUNT_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>&1)
			if test $status -eq 0
				set remoteBranch $remoteBranchOutput
			end

			if test -z "$remoteBranch"
				echo "Warning: No upstream branch for '$currentBranch'. Setting to origin/master." >&2
				git -C "$FOUNT_DIR" branch --set-upstream-to origin/master $currentBranch
				set remoteBranch "origin/master"
			end

			set status (git -C "$FOUNT_DIR" status --porcelain)
			if test (count $status) -gt 0
				echo "Warning: Uncommitted changes. Stash or commit before updating." >&2
			end

			set mergeBase (git -C "$FOUNT_DIR" merge-base "$currentBranch" "$remoteBranch")
			set localCommit (git -C "$FOUNT_DIR" rev-parse "$currentBranch")
			set remoteCommit (git -C "$FOUNT_DIR" rev-parse "$remoteBranch")

			if test "$localCommit" != "$remoteCommit"
				if test "$mergeBase" = "$localCommit"
					echo "Updating from remote repository (fast-forward)..."
					git -C "$FOUNT_DIR" fetch origin  # Fetch again
					git -C "$FOUNT_DIR" reset --hard "$remoteBranch"
				else if test "$mergeBase" = "$remoteCommit"
					echo "Local branch is ahead of remote. No update needed."
				else
					echo "Local and remote branches have diverged. Force updating..."
					git -C "$FOUNT_DIR" fetch origin
					git -C "$FOUNT_DIR" reset --hard "$remoteBranch"
				end
			else
				echo "Already up to date."
			end
		end
	end
else
	echo "Git is not installed, skipping fount update"
end

if test ($IN_TERMUX -eq 0 -a -z (type -q deno)) -o ($IN_TERMUX -eq 1 -a not -f ~/.deno/bin/deno.glibc.sh)
	if test $IN_TERMUX -eq 1
		echo "Installing Deno for Termux..."
		# Termux 环境下的特殊处理
		set -e
		yes y | pkg upgrade -y
		pkg install -y pacman patchelf which time ldd tree

		# 安装 glibc-runner, bash, patchelf, resolv-conf - 检查是否已安装 glibc-runner
		if not type -q glibc-runner
			# 初始化和更新 pacman
			pacman-key --init
			pacman-key --populate
			pacman -Syu --noconfirm

			pacman -Sy glibc-runner --assume-installed bash,patchelf,resolv-conf --noconfirm
		end
		set +e

		# Install Deno.js
		curl -fsSL https://deno.land/install.sh | sh -s -- -y
		set DENO_INSTALL "$HOME/.deno"
		set DENO_BIN_PATH "$DENO_INSTALL/bin/deno"

		# Explicitly set execute permissions
		chmod +x "$DENO_BIN_PATH"

		# Source bashrc and PATH setup  (提前 source)
		set -gx DENO_INSTALL "$HOME/.deno"
		set -gx PATH "$PATH:$DENO_INSTALL/bin"

		# 将 Deno 添加到 .profile (如果尚不存在)  <--- 修改为 .profile
		if not grep -q "export PATH=.*$DENO_INSTALL/bin" "$HOME/.profile"
			echo "export PATH=\"\$PATH:$DENO_INSTALL/bin\"" >> "$HOME/.profile"
		end

		source "$HOME/.profile"
		if string match -q -r '.*/zsh$' $SHELL
			source "$HOME/.zshrc"
		else
			source "$HOME/.bashrc"
		end

		# 尝试使用 glibc-runner 运行 Deno，使用绝对路径(在source之后)
		set GLIBC_RUNNER_PATH (which glibc-runner)
		if not "$GLIBC_RUNNER_PATH" "$DENO_BIN_PATH" -V &> /dev/null
			echo "Error: Deno failed to execute with glibc-runner." >&2
			rm -rf "$DENO_INSTALL"
			exit 1  # 首次运行失败直接退出
		end

		# Check 'command -v deno' again (after direct execution and PATH setup)
		if not type -q deno
			echo "Warning: 'deno' command not found in PATH." >&2
			# 不退出，因为后面可能通过 wrapper 运行
		end

		# Patch Deno.js (Termux)
		patch_deno

		echo "Deno installed for Termux."
	else
		# 非 Termux 环境下的普通安装
		curl -fsSL https://deno.land/install.sh | sh -s -- -y
		source "$HOME/.profile"
		if string match -q -r '.*/zsh$' $SHELL
			source "$HOME/.zshrc"
		else
			source "$HOME/.bashrc"
		end
		echo "Deno installed."
	end

	if not type -q deno
		echo "Deno missing, you cant run fount without deno (final check)"
		exit 1  # 最终检查，如果还是找不到，则退出
	end
end

if test $IN_DOCKER -eq 1
	echo "Skipping deno upgrade in Docker environment"
else
	# 使用 run_deno 来获取 Deno 版本信息
	set deno_version_before (run_deno -V 2>&1)
	if test -z "$deno_version_before"
		echo "Error: Could not determine current Deno version." >&2
	else
		run_deno upgrade -q
		set deno_version_after (run_deno -V 2>&1)

		# 检查是否需要重新 patch deno
		if test "$deno_version_before" != "$deno_version_after" -a $IN_TERMUX -eq 1
			patch_deno
		end
	end
end
run_deno -V
if not -d "$FOUNT_DIR/node_modules" -o (count $argv) -gt 0 -a $argv[1] = 'init'
	echo "Installing dependencies..."
	set +e
	run_deno install --reload --allow-scripts --allow-all --node-modules-dir=auto --entrypoint "$FOUNT_DIR/src/server/index.mjs"
	run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" "shutdown"
	set -e
end

function run
	if test (count $argv) -gt 0 -a $argv[1] = 'debug'
		set newargs $argv[2..-1]
		run_deno run --allow-scripts --allow-all --inspect-brk "$FOUNT_DIR/src/server/index.mjs" $newargs
	else
		run_deno run --allow-scripts --allow-all "$FOUNT_DIR/src/server/index.mjs" $argv
	end
end

if test (count $argv) -gt 0 -a $argv[1] = 'init'
	exit 0
else if test (count $argv) -gt 0 -a $argv[1] = 'keepalive'
	set runargs $argv[2..-1]
	run $runargs
	while test $status
		run
	end
else
	run $argv
end

exit $status
