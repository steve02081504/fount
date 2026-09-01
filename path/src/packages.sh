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

# --- 包管理器状态：跨安装共享目录，含锁与刷新节流 ---
pkg_state_dir() {
	printf '%s' "${FOUNT_PKG_STATE_DIR:-${TMPDIR:-${TEMP:-/tmp}}/fount/package}"
}

pkg_refresh_interval() {
	printf '%s' "${FOUNT_PKG_REFRESH_INTERVAL:-600}"
}

# 解析符号链接得到真实路径（兼容 BSD readlink，不用 readlink -f）。
resolve_realpath() {
	local path="$1" link dirname_path
	[ -n "$path" ] || return 1
	while [ -L "$path" ]; do
		link=$(readlink "$path") || return 1
		case "$link" in
		/*) path="$link" ;;
		*) dirname_path=$(dirname "$path"); path="$dirname_path/$link" ;;
		esac
	done
	printf '%s' "$path"
}

# 检测可执行文件路径归属哪个包管理器。输出 "<manager> <package>"；未被识别管理则输出空。
pkg_owner_of() {
	local path="$1" out pkg manager
	if command -v dpkg &>/dev/null && out=$(dpkg -S "$path" 2>/dev/null) && [ -n "$out" ]; then
		printf 'apt-get %s\n' "${out%%:*}"
		return 0
	fi
	if command -v pacman &>/dev/null && pkg=$(pacman -Qqo -- "$path" 2>/dev/null) && [ -n "$pkg" ]; then
		printf 'pacman %s\n' "$pkg"
		return 0
	fi
	if command -v rpm &>/dev/null && pkg=$(rpm -qf "$path" 2>/dev/null) && [ -n "$pkg" ]; then
		pkg=$(printf '%s\n' "$pkg" | head -n 1)
		for manager in dnf yum zypper; do
			if command -v "$manager" &>/dev/null; then
				printf '%s %s\n' "$manager" "$pkg"
				return 0
			fi
		done
	fi
	if command -v apk &>/dev/null && out=$(apk info -W "$path" 2>/dev/null) && [ -n "$out" ]; then
		pkg=$(printf '%s\n' "$out" | sed -n 's/^.* is owned by \(.*\)$/\1/p' | head -n 1)
		if [ -n "$pkg" ]; then
			printf 'apk %s\n' "$pkg"
			return 0
		fi
	fi
	if command -v brew &>/dev/null; then
		local prefix
		prefix=$(brew --prefix 2>/dev/null) || prefix=/usr/local
		case "$path" in
		"$prefix"/Cellar/*)
			pkg=${path#"$prefix/Cellar/"}
			printf 'brew %s\n' "${pkg%%/*}"
			return 0
			;;
		esac
	fi
	if command -v pkg &>/dev/null && out=$(pkg which -q -- "$path" 2>/dev/null) && [ -n "$out" ]; then
		printf 'pkg %s\n' "$out"
		return 0
	fi
	if command -v snap &>/dev/null; then
		case "$path" in
		/snap/* | /var/lib/snapd/snap/*)
			pkg=${path#/snap/}
			pkg=${pkg#/var/lib/snapd/snap/}
			printf 'snap %s\n' "${pkg%%/*}"
			return 0
			;;
		esac
	fi
	return 1
}

# 按包管理器名加锁：同一时刻只有一个同名包管理器在运行。
pkg_lock_acquire() {
	local manager="$1" state_dir pkg_lock_dir pid retry_count
	state_dir=$(pkg_state_dir)
	pkg_lock_dir="$state_dir/$manager.lock"
	mkdir -p "$state_dir" 2>/dev/null || return 1
	retry_count=0
	while ! mkdir "$pkg_lock_dir" 2>/dev/null; do
		if [ -f "$pkg_lock_dir/pid" ]; then
			pid=$(cat "$pkg_lock_dir/pid" 2>/dev/null)
			if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
				rm -rf "$pkg_lock_dir"
				continue
			fi
		fi
		retry_count=$((retry_count + 1))
		[ "$retry_count" -ge $(( ${FOUNT_PKG_LOCK_TIMEOUT:-300} * 10 )) ] && return 1
		sleep 0.1 2>/dev/null || sleep 1
	done
	printf '%s\n' "$$" >"$pkg_lock_dir/pid"
	FOUNT_PKG_LOCK_DIR="$pkg_lock_dir"
	return 0
}

pkg_lock_release() {
	[ -n "${FOUNT_PKG_LOCK_DIR:-}" ] || return 0
	rm -rf "$FOUNT_PKG_LOCK_DIR"
	unset FOUNT_PKG_LOCK_DIR
}

# 在锁内执行命令。
with_pkg_lock() {
	local manager="$1" exit_status
	shift
	pkg_lock_acquire "$manager" || return 1
	"$@"
	exit_status=$?
	pkg_lock_release
	return $exit_status
}

# 数据库刷新节流：>10min 或从未刷新才返回需要刷新。
pkg_db_refresh_needed() {
	local manager="$1" refresh_file now last
	refresh_file="$(pkg_state_dir)/$manager.refresh"
	[ -f "$refresh_file" ] || return 0
	now=$(date +%s 2>/dev/null) || return 0
	last=$(cat "$refresh_file" 2>/dev/null) || return 0
	[ $((now - last)) -ge "$(pkg_refresh_interval)" ]
}

pkg_db_refresh_mark() {
	local manager="$1" state_dir
	state_dir=$(pkg_state_dir)
	mkdir -p "$state_dir" 2>/dev/null || return 1
	printf '%s\n' "$(date +%s 2>/dev/null)" >"$state_dir/$manager.refresh" 2>/dev/null
}

install_with_manager() {
	local manager_cmd="$1"
	local package_to_install="$2"
	local update_args="" install_args="" has_sudo="" exit_status

	if ! command -v "$manager_cmd" &>/dev/null; then
		return 1
	fi

	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then
		has_sudo="sudo"
	fi

	case "$manager_cmd" in
	"apt-get")  update_args="update -y";          install_args="install -y" ;;
	"pacman")   install_args="-Syu --needed --noconfirm" ;;
	"dnf")      update_args="makecache";          install_args="install -y" ;;
	"yum")      update_args="makecache fast";     install_args="install -y" ;;
	"zypper")   update_args="refresh";            install_args="install -y --no-confirm" ;;
	"pkg")      update_args="update -y";          install_args="install -y" ;;
	"apk")      install_args="add --update" ;;
	"brew")     has_sudo="";                      install_args="install" ;;
	"snap")     install_args="install" ;;
	*) return 1 ;;
	esac

	pkg_lock_acquire "$manager_cmd" || return 1
	if [[ -n "$update_args" ]] && pkg_db_refresh_needed "$manager_cmd"; then
		# shellcheck disable=SC2086
		$has_sudo "$manager_cmd" $update_args && pkg_db_refresh_mark "$manager_cmd"
	fi
	# shellcheck disable=SC2086
	$has_sudo "$manager_cmd" $install_args "$package_to_install"
	exit_status=$?
	pkg_lock_release
	return $exit_status
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
	local update_args="" upgrade_args="" has_sudo="" exit_status

	if ! command -v "$manager_cmd" &>/dev/null; then
		return 1
	fi

	if [[ $(id -u) -ne 0 ]] && command -v sudo &>/dev/null; then
		has_sudo="sudo"
	fi

	case "$manager_cmd" in
	"apt-get") update_args="update -y";          upgrade_args="install --only-upgrade -y" ;;
	"pacman")  upgrade_args="-Syu --noconfirm" ;;
	"dnf")     update_args="makecache";          upgrade_args="update -y" ;;
	"yum")     update_args="makecache fast";     upgrade_args="update -y" ;;
	"zypper")  update_args="refresh";            upgrade_args="update -y --no-confirm" ;;
	"pkg")     update_args="update -y";          upgrade_args="upgrade -y" ;;
	"apk")     update_args="update";             upgrade_args="upgrade" ;;
	"brew")    has_sudo="";                      upgrade_args="upgrade" ;;
	"snap")     upgrade_args="refresh" ;;
	*) return 1 ;;
	esac

	pkg_lock_acquire "$manager_cmd" || return 1
	if [[ -n "$update_args" ]] && pkg_db_refresh_needed "$manager_cmd"; then
		# shellcheck disable=SC2086
		$has_sudo "$manager_cmd" $update_args >/dev/null 2>&1 && pkg_db_refresh_mark "$manager_cmd"
	fi
	# shellcheck disable=SC2086
	$has_sudo "$manager_cmd" $upgrade_args "$package_to_upgrade" >/dev/null 2>&1
	exit_status=$?
	pkg_lock_release
	return $exit_status
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

	if command -v apt-get &>/dev/null && with_pkg_lock apt-get $has_sudo apt-get purge -y "$package_name" &>/dev/null; then return 0; fi
	if command -v pacman  &>/dev/null && with_pkg_lock pacman $has_sudo pacman -Rns --noconfirm "$package_name" &>/dev/null; then return 0; fi
	if command -v dnf     &>/dev/null && with_pkg_lock dnf $has_sudo dnf remove -y "$package_name" &>/dev/null; then return 0; fi
	if command -v yum     &>/dev/null && with_pkg_lock yum $has_sudo yum remove -y "$package_name" &>/dev/null; then return 0; fi
	if command -v zypper  &>/dev/null && with_pkg_lock zypper $has_sudo zypper remove -y --no-confirm "$package_name" &>/dev/null; then return 0; fi
	if command -v apk     &>/dev/null && with_pkg_lock apk $has_sudo apk del "$package_name" &>/dev/null; then return 0; fi
	if command -v brew    &>/dev/null && with_pkg_lock brew brew uninstall "$package_name" &>/dev/null; then return 0; fi
	if command -v snap    &>/dev/null && with_pkg_lock snap $has_sudo snap remove "$package_name" &>/dev/null; then return 0; fi
	if command -v pkg     &>/dev/null && with_pkg_lock pkg pkg uninstall -y "$package_name" &>/dev/null; then return 0; fi

	echo -e "${C_YELLOW}Failed to remove ${package_name}. It might not be installed or managed by a recognized package manager.${C_RESET}" >&2
	return 1
}
