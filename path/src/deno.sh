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

install_deno() {
	if command -v deno &>/dev/null || [[ $IN_TERMUX -eq 1 && -f ~/.deno/bin/deno.glibc.sh ]]; then return 0; fi
	if [[ -z "$(command -v deno)" && -f "$HOME/.deno/env" ]]; then
		# shellcheck disable=SC1091
		. "$HOME/.deno/env"
	fi
	if command -v deno &>/dev/null || [[ $IN_TERMUX -eq 1 && -f ~/.deno/bin/deno.glibc.sh ]]; then return 0; fi

	if install_package "deno" "deno"; then
		return 0
	fi

	install_package "curl" "curl" || exit 1
	if [[ $IN_TERMUX -eq 1 ]]; then
		get_i18n 'deno.installingTermux'
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
		export PATH="$HOME/.deno/bin:$PATH"
		hash -r
		patch_deno
		touch "$AUTO_INSTALLED_DENO_FLAG"
	else
		get_i18n 'deno.missing'
		if ! curl -fsSL https://deno.land/install.sh | sh -s -- -y; then
			get_i18n 'deno.installFailedFallback'
			install_package "unzip" "unzip" || exit 1
			local deno_dl_url="https://github.com/denoland/deno/releases/latest/download/deno-"
			local arch_target current_arch
			current_arch=$(uname -m)
			case "$OS_TYPE" in
			Linux*)  [[ "$current_arch" = "aarch64" ]] && arch_target="aarch64-unknown-linux-gnu.zip" || arch_target="x86_64-unknown-linux-gnu.zip" ;;
			Darwin*) [[ "$current_arch" = "arm64" ]]   && arch_target="aarch64-apple-darwin.zip"      || arch_target="x86_64-apple-darwin.zip" ;;
			*)       arch_target="x86_64-unknown-linux-gnu.zip" ;;
			esac
			mkdir -p "$FOUNT_DIR/path"
			if curl -fL -o "/tmp/deno.zip" "${deno_dl_url}${arch_target}" && unzip -o "/tmp/deno.zip" -d "$FOUNT_DIR/path"; then
				rm "/tmp/deno.zip"
				chmod +x "$FOUNT_DIR/path/deno"
				export PATH="$PATH:$FOUNT_DIR/path"
			else
				print_i18n_red 'deno.isRequired' >&2
				exit 1
			fi
		fi
		# shellcheck disable=SC1091
		[ -f "$HOME/.deno/env" ] && . "$HOME/.deno/env"
		export PATH="$PATH:$HOME/.deno/bin"
		touch "$AUTO_INSTALLED_DENO_FLAG"
	fi
	if ! command -v deno &>/dev/null; then
		print_i18n_red 'deno.isRequired' >&2
		exit 1
	fi
}

base_deno_upgrade() {
	local deno_version_before
	deno_version_before=$(run_deno -V 2>&1)
	if [[ -z "$deno_version_before" ]]; then
		print_i18n_red 'deno.notWorking' >&2
		return 1
	fi

	if upgrade_package "deno" "deno"; then
		return 0
	fi

	local deno_upgrade_channel="stable"
	if [[ "$deno_version_before" == *"+"* ]]; then
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
	if [ -f "$upgraded_flag" ]; then
		( base_deno_upgrade ) &
		return
	fi
	if ! base_deno_upgrade; then
		return
	else
		mkdir -p "$(dirname "$upgraded_flag")"
		touch "$upgraded_flag"
	fi
}

