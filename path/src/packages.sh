#!/usr/bin/env bash
# Package management: install, upgrade, uninstall, tracking

INSTALLED_SYSTEM_PACKAGES_ARRAY=()
INSTALLED_PACMAN_PACKAGES_ARRAY=()

load_installed_packages() {
	mkdir -p "$INSTALLER_DATA_DIR"
	if [[ -f "$INSTALLED_SYSTEM_PACKAGES_FILE" ]]; then
		IFS=';' read -r -a INSTALLED_SYSTEM_PACKAGES_ARRAY <<<"$(tr -d '\n' <"$INSTALLED_SYSTEM_PACKAGES_FILE")"
	fi
	if [[ -f "$INSTALLED_PACMAN_PACKAGES_FILE" ]]; then
		IFS=';' read -r -a INSTALLED_PACMAN_PACKAGES_ARRAY <<<"$(tr -d '\n' <"$INSTALLED_PACMAN_PACKAGES_FILE")"
	fi
	if [[ -n "$FOUNT_AUTO_INSTALLED_PACKAGES" ]]; then
		IFS=';' read -r -a FOUNT_AUTO_INSTALLED_PACKAGES_ARRAY <<<"$FOUNT_AUTO_INSTALLED_PACKAGES"
		INSTALLED_SYSTEM_PACKAGES_ARRAY+=("${FOUNT_AUTO_INSTALLED_PACKAGES_ARRAY[@]}")
		# shellcheck disable=SC2207
		INSTALLED_SYSTEM_PACKAGES_ARRAY=($(echo "${INSTALLED_SYSTEM_PACKAGES_ARRAY[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))
		(
			IFS=';'
			echo "${INSTALLED_SYSTEM_PACKAGES_ARRAY[*]}"
		) >"$INSTALLED_SYSTEM_PACKAGES_FILE"
	fi
}

save_installed_packages() {
	mkdir -p "$INSTALLER_DATA_DIR"
	(
		IFS=';'
		echo "${INSTALLED_SYSTEM_PACKAGES_ARRAY[*]}"
	) >"$INSTALLED_SYSTEM_PACKAGES_FILE"
	if [[ $IN_TERMUX -eq 1 ]]; then
		(
			IFS=';'
			echo "${INSTALLED_PACMAN_PACKAGES_ARRAY[*]}"
		) >"$INSTALLED_PACMAN_PACKAGES_FILE"
	fi
}

add_package_to_tracker() {
	local package="$1"
	local array_name="$2"
	local array_ref="${array_name}[@]"
	local found=0
	for p in "${!array_ref}"; do
		if [[ "$p" == "$package" ]]; then
			found=1
			break
		fi
	done
	if [[ $found -eq 0 ]]; then
		eval "${array_name}+=(\"$package\")"
		save_installed_packages
	fi
}

install_with_manager() {
	local manager_cmd="$1"
	local package_to_install="$2"
	local update_args="" install_args="" has_sudo=""

	if ! command -v "$manager_cmd" &>/dev/null; then
		return 1
	fi

	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then
		has_sudo="sudo"
	fi

	case "$manager_cmd" in
	"apt-get")  update_args="update -y";          install_args="install -y" ;;
	"pacman")   update_args="-Syy --noconfirm";   install_args="-S --needed --noconfirm" ;;
	"dnf")      update_args="makecache";          install_args="install -y" ;;
	"yum")      update_args="makecache fast";     install_args="install -y" ;;
	"zypper")   update_args="refresh";            install_args="install -y --no-confirm" ;;
	"pkg")      update_args="update -y";          install_args="install -y" ;;
	"apk")      install_args="add --update" ;;
	"brew")     has_sudo="";                      install_args="install" ;;
	"snap")
		if ! command -v sudo &>/dev/null; then return 1; fi
		has_sudo="sudo"
		install_args="install"
		;;
	*) return 1 ;;
	esac

	if [[ -n "$update_args" ]]; then
		# shellcheck disable=SC2086
		$has_sudo "$manager_cmd" $update_args
	fi
	# shellcheck disable=SC2086
	$has_sudo "$manager_cmd" $install_args "$package_to_install"
}

install_package() {
	local command_name="$1"
	local package_list_str="${2:-$command_name}"
	# shellcheck disable=SC2206
	local package_list=($package_list_str)

	if command -v "$command_name" &>/dev/null; then
		return 0
	fi

	for package in "${package_list[@]}"; do
		if
			install_with_manager "pkg"     "$package" ||
			install_with_manager "apt-get" "$package" ||
			install_with_manager "pacman"  "$package" ||
			install_with_manager "dnf"     "$package" ||
			install_with_manager "yum"     "$package" ||
			install_with_manager "zypper"  "$package" ||
			install_with_manager "apk"     "$package" ||
			install_with_manager "brew"    "$package" ||
			install_with_manager "snap"    "$package"
		then
			if command -v "$command_name" &>/dev/null; then
				add_package_to_tracker "$package" "INSTALLED_SYSTEM_PACKAGES_ARRAY"
				return 0
			fi
		fi
	done

	echo -e "${C_RED}Error: $command_name installation failed.${C_RESET}" >&2
	return 1
}

upgrade_with_manager() {
	local manager_cmd="$1"
	local package_to_upgrade="$2"
	local update_args="" upgrade_args="" has_sudo=""

	if ! command -v "$manager_cmd" &>/dev/null; then
		return 1
	fi

	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then
		has_sudo="sudo"
	fi

	case "$manager_cmd" in
	"apt-get") update_args="update -y";          upgrade_args="install --only-upgrade -y" ;;
	"pacman")  update_args="-Sy --noconfirm";    upgrade_args="-S --noconfirm" ;;
	"dnf")     update_args="makecache";          upgrade_args="update -y" ;;
	"yum")     update_args="makecache fast";     upgrade_args="update -y" ;;
	"zypper")  update_args="refresh";            upgrade_args="update -y --no-confirm" ;;
	"pkg")     update_args="update -y";          upgrade_args="upgrade -y" ;;
	"apk")     update_args="update";             upgrade_args="upgrade" ;;
	"brew")    has_sudo="";                      upgrade_args="upgrade" ;;
	"snap")
		if ! command -v sudo &>/dev/null; then return 1; fi
		has_sudo="sudo"
		upgrade_args="refresh"
		;;
	*) return 1 ;;
	esac

	if [[ -n "$update_args" ]]; then
		# shellcheck disable=SC2086
		$has_sudo "$manager_cmd" $update_args >/dev/null 2>&1 || true
	fi
	# shellcheck disable=SC2086
	$has_sudo "$manager_cmd" $upgrade_args "$package_to_upgrade" >/dev/null 2>&1
}

upgrade_package() {
	local command_name="$1"
	local package_list_str="${2:-$command_name}"
	# shellcheck disable=SC2206
	local package_list=($package_list_str)

	for package in "${package_list[@]}"; do
		if
			upgrade_with_manager "pkg"     "$package" ||
			upgrade_with_manager "apt-get" "$package" ||
			upgrade_with_manager "pacman"  "$package" ||
			upgrade_with_manager "dnf"     "$package" ||
			upgrade_with_manager "yum"     "$package" ||
			upgrade_with_manager "zypper"  "$package" ||
			upgrade_with_manager "apk"     "$package" ||
			upgrade_with_manager "brew"    "$package" ||
			upgrade_with_manager "snap"    "$package"
		then
			if command -v "$command_name" &>/dev/null; then
				return 0
			fi
		fi
	done
	return 1
}

uninstall_package() {
	local package_name="$1"
	local has_sudo=""
	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then has_sudo="sudo"; fi

	if command -v apt-get &>/dev/null && $has_sudo apt-get purge -y "$package_name" &>/dev/null; then return 0; fi
	if command -v pacman  &>/dev/null && $has_sudo pacman -Rns --noconfirm "$package_name" &>/dev/null; then return 0; fi
	if command -v dnf     &>/dev/null && $has_sudo dnf remove -y "$package_name" &>/dev/null; then return 0; fi
	if command -v yum     &>/dev/null && $has_sudo yum remove -y "$package_name" &>/dev/null; then return 0; fi
	if command -v zypper  &>/dev/null && $has_sudo zypper remove -y --no-confirm "$package_name" &>/dev/null; then return 0; fi
	if command -v apk     &>/dev/null && $has_sudo apk del "$package_name" &>/dev/null; then return 0; fi
	if command -v brew    &>/dev/null && brew uninstall "$package_name" &>/dev/null; then return 0; fi
	if command -v snap    &>/dev/null && $has_sudo snap remove "$package_name" &>/dev/null; then return 0; fi
	if command -v pkg     &>/dev/null && pkg uninstall -y "$package_name" &>/dev/null; then return 0; fi

	echo -e "${C_YELLOW}Failed to remove ${package_name}. It might not be installed or managed by a recognized package manager.${C_RESET}" >&2
	return 1
}

