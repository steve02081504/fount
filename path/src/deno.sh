#!/usr/bin/env bash
# Deno runtime: wrap, patch (Termux), install, upgrade

run_deno() {
	if [[ $IN_TERMUX -eq 1 ]]; then
		if command -v deno.glibc.sh &>/dev/null; then
			command deno.glibc.sh "$@"
			return $?
		elif command -v glibc-runner &>/dev/null; then
			command glibc-runner "$(command -v deno)" "$@"
			return $?
		fi
	fi
	command deno "$@"
}

patch_deno() {
	local deno_bin
	deno_bin=$(command -v deno)

	if [[ -z "$deno_bin" ]]; then
		print_i18n_red 'deno.patchMissing' >&2
		return 1
	fi

	install_package "patchelf" "patchelf" || return 1

	local interp_path arch
	arch=$(uname -m)

	if [[ -z "$PREFIX" ]]; then
		PREFIX="/data/data/com.termux/files/usr"
	fi

	case "$arch" in
	"aarch64") interp_path="${PREFIX}/glibc/lib/ld-linux-aarch64.so.1" ;;
	"x86_64")  interp_path="${PREFIX}/glibc/lib/ld-linux-x86-64.so.2" ;;
	"i686")    interp_path="${PREFIX}/glibc/lib/ld-linux.so.2" ;;
	*)
		print_i18n_red 'deno.patchUnsupportedArch' 'arch' "$arch" >&2
		return 1
		;;
	esac

	if ! patchelf --set-rpath "${ORIGIN}/../glibc/lib" --set-interpreter "$interp_path" "$deno_bin"; then
		print_i18n_red 'deno.patchFailed' >&2
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

install_deno_from_official_script() {
	install_package "curl" "curl" || return 1
	curl -fsSL https://deno.land/install.sh | sh -s -- -y
}

install_deno_from_github_zip() {
	local arch base zip_name
	base="https://github.com/denoland/deno/releases/latest/download/deno-"
	arch=$(uname -m)
	case "$OS_TYPE" in
	Linux*)
		if [[ "$arch" = aarch64 ]]; then zip_name="aarch64-unknown-linux-gnu.zip"
		else zip_name="x86_64-unknown-linux-gnu.zip"; fi
		;;
	Darwin*)
		if [[ "$arch" = arm64 ]]; then zip_name="aarch64-apple-darwin.zip"
		else zip_name="x86_64-apple-darwin.zip"; fi
		;;
	*) zip_name="x86_64-unknown-linux-gnu.zip" ;;
	esac
	get_i18n 'deno.installFailedFallback'
	install_package "unzip" "unzip" || return 1
	install_package "curl" "curl" || return 1
	mkdir -p "$FOUNT_DIR/path"
	curl -fL -o /tmp/deno.zip "${base}${zip_name}" || return 1
	unzip -o /tmp/deno.zip -d "$FOUNT_DIR/path" || return 1
	chmod +x "$FOUNT_DIR/path/deno"
	rm -f /tmp/deno.zip
}

install_deno_termux() {
	local pkg
	get_i18n 'deno.installingTermux'
	set -e
	for pkg in patchelf which time ldd tree pacman; do
		command -v "$pkg" &>/dev/null || add_package_to_tracker "$pkg" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
	done
	yes y | pkg upgrade -y
	pkg install -y pacman patchelf which time ldd tree
	pacman-key --init && pacman-key --populate && pacman -Syu --noconfirm
	pacman -Sy glibc-runner --assume-installed bash,patchelf,resolv-conf --noconfirm
	add_package_to_tracker "glibc-runner" "INSTALLED_PACMAN_PACKAGES_ARRAY"
	install_deno_from_official_script
	set +e
	export PATH="$HOME/.deno/bin:$PATH"
	hash -r
	patch_deno
}

deno_on_path() {
	[[ $IN_TERMUX -eq 1 && -f ~/.deno/bin/deno.glibc.sh ]] && return 0
	command -v deno &>/dev/null
}

install_deno() {
	export PATH="$HOME/.deno/bin:$FOUNT_DIR/path:$PATH"
	hash -r 2>/dev/null || true
	deno_on_path && return 0

	install_package "deno" "deno" || true
	deno_on_path && return 0

	if [[ $IN_TERMUX -eq 1 ]]; then
		install_deno_termux || true
	else
		get_i18n 'deno.missing'
		install_deno_from_official_script || true
		export PATH="$HOME/.deno/bin:$FOUNT_DIR/path:$PATH"
		hash -r 2>/dev/null || true
		deno_on_path && return 0
		install_deno_from_github_zip || true
		export PATH="$HOME/.deno/bin:$FOUNT_DIR/path:$PATH"
		hash -r 2>/dev/null || true
	fi

	if ! deno_on_path; then
		print_i18n_red 'deno.isRequired' >&2
		exit 1
	fi
	mkdir -p "$(dirname "$AUTO_INSTALLED_DENO_FLAG")"
	touch "$AUTO_INSTALLED_DENO_FLAG"
}

deno_pinned_spec() {
	if [ -f "$FOUNT_DIR/.deno-version" ]; then
		local spec
		spec=$(awk 'NR==1{ sub(/^[[:space:]]+/, ""); sub(/[[:space:]]+$/, ""); print }' "$FOUNT_DIR/.deno-version")
		if [ -n "$spec" ]; then
			printf '%s\n' "$spec"
		fi
	fi
}

base_deno_upgrade() {
	local force_channel="${1:-}"
	local pacman_host=0
	if [[ "$OSTYPE" == linux* && $IN_TERMUX -ne 1 && ! -d /data/data/com.termux ]] && command -v pacman &>/dev/null; then
		pacman_host=1
		local deno_binary
		deno_binary=$(readlink -f "$(command -v deno)") || return 1
		if pacman -Qqo -- "$deno_binary" &>/dev/null; then
			print_i18n_yellow 'deno.managedByPacman' 'path' "$deno_binary" >&2
			return 0
		fi
	fi
	local deno_version_before
	deno_version_before=$(run_deno -V 2>&1)
	if [[ -z "$deno_version_before" ]]; then
		print_i18n_red 'deno.notWorking' >&2
		return 1
	fi

	# 仓库 pin 文件优先：e.g. `pr 36606` / `canary` / `2.9.5`
	local pinned upgrade_args deno_upgrade_exit_code
	pinned=$(deno_pinned_spec)
	if [ -n "$pinned" ]; then
		read -r -a upgrade_args <<<"$pinned"
		run_deno upgrade -q "${upgrade_args[@]}" 2> >(tee /dev/stderr)
		deno_upgrade_exit_code=$?
		if [[ $deno_upgrade_exit_code -ne 0 ]]; then
			if [[ $IN_TERMUX -eq 1 ]]; then
				get_i18n 'deno.upgradeFailedTermux'
				rm -rf "$HOME/.deno"
				install_deno
				run_deno upgrade -q "${upgrade_args[@]}" 2> >(tee /dev/stderr)
				deno_upgrade_exit_code=$?
				if [[ $deno_upgrade_exit_code -ne 0 ]]; then
					return 1
				fi
				return 0
			else
				print_i18n_yellow 'deno.upgradeFailed' >&2
				return 1
			fi
		fi
		return 0
	fi

	if [[ -z "$force_channel" && $pacman_host -eq 0 ]] && upgrade_package "deno" "deno"; then
		return 0
	fi

	local deno_upgrade_channel="stable"
	if [[ -n "$force_channel" ]]; then
		deno_upgrade_channel="$force_channel"
	elif [[ "$deno_version_before" == *"+"* ]]; then
		deno_upgrade_channel="canary"
	elif [[ "$deno_version_before" == *"-rc"* ]]; then
		deno_upgrade_channel="rc"
	fi

	local errorOut deno_upgrade_exit_code
	errorOut=$(deno upgrade -q "$deno_upgrade_channel" 2> >(tee /dev/stderr))
	deno_upgrade_exit_code=$?
	if [[ $errorOut == *"USAGE"* || $errorOut == *"unexpected argument"* ]]; then
		run_deno upgrade -q
		deno_upgrade_exit_code=$?
	fi
	if [[ $deno_upgrade_exit_code -ne 0 ]]; then
		if [[ $IN_TERMUX -eq 1 ]]; then
			get_i18n 'deno.upgradeFailedTermux'
			rm -rf "$HOME/.deno"
			install_deno
			return $?
		else
			print_i18n_yellow 'deno.upgradeFailed' >&2
			return 1
		fi
	fi
}

deno_upgrade() {
	local upgraded_flag="$FOUNT_DIR/data/installer/deno_upgraded"
	if ! base_deno_upgrade "$@"; then
		return
	fi
	mkdir -p "$(dirname "$upgraded_flag")"
	touch "$upgraded_flag"
}
