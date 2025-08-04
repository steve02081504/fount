#!/bin/sh
# shellcheck disable=SC1007
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FOUNT_AUTO_INSTALLED_PACKAGES="${FOUNT_AUTO_INSTALLED_PACKAGES:-}"

# 函数: 安装包
install_package() {
	_command_name="$1"
	_package_list=${2:-$_command_name}
	_has_sudo=""
	_installed_pkg_name="" # 用于记录最终成功安装的包名

	# 1. 如果命令已存在，直接成功返回
	if command -v "$_command_name" >/dev/null 2>&1; then
		return 0
	fi

	# 2. 确定是否需要 sudo
	if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
		_has_sudo="sudo"
	fi

	# 3. 遍历所有候选包名
	for _package in $_package_list; do
		# 4. 对每个候选包，依次尝试所有包管理器

		# 尝试 apt-get
		if command -v apt-get >/dev/null 2>&1; then
			$_has_sudo apt-get update -y
			$_has_sudo apt-get install -y "$_package"
			if command -v "$_command_name" >/dev/null 2>&1; then
				_installed_pkg_name="$_package"
				break
			fi
		fi

		# 尝试 pacman
		if command -v pacman >/dev/null 2>&1; then
			$_has_sudo pacman -Syy --noconfirm
			$_has_sudo pacman -S --needed --noconfirm "$_package"
			if command -v "$_command_name" >/dev/null 2>&1; then
				_installed_pkg_name="$_package"
				break
			fi
		fi

		# 尝试 dnf
		if command -v dnf >/dev/null 2>&1; then
			$_has_sudo dnf install -y "$_package"
			if command -v "$_command_name" >/dev/null 2>&1; then
				_installed_pkg_name="$_package"
				break
			fi
		fi

		# 尝试 yum
		if command -v yum >/dev/null 2>&1; then
			$_has_sudo yum install -y "$_package"
			if command -v "$_command_name" >/dev/null 2>&1; then
				_installed_pkg_name="$_package"
				break
			fi
		fi

		# 尝试 zypper
		if command -v zypper >/dev/null 2>&1; then
			$_has_sudo zypper install -y --no-confirm "$_package"
			if command -v "$_command_name" >/dev/null 2>&1; then
				_installed_pkg_name="$_package"
				break
			fi
		fi

		# 尝试 apk
		if command -v apk >/dev/null 2>&1; then
			# apk 需要 root 权限，但通常在容器中，sudo 可能不存在
			if [ "$(id -u)" -eq 0 ]; then
				apk add --update "$_package"
			else
				$_has_sudo apk add --update "$_package"
			fi
			if command -v "$_command_name" >/dev/null 2>&1; then
				_installed_pkg_name="$_package"
				break
			fi
		fi

		# 尝试 brew
		if command -v brew >/dev/null 2>&1; then
			# brew 不应该使用 sudo
			if ! brew list --formula "$_package"; then
				brew install "$_package"
			fi
			if command -v "$_command_name" >/dev/null 2>&1; then
				_installed_pkg_name="$_package"
				break
			fi
		fi

		# 尝试 pkg (Termux)
		if command -v pkg >/dev/null 2>&1; then
			pkg install -y "$_package"
			if command -v "$_command_name" >/dev/null 2>&1; then
				_installed_pkg_name="$_package"
				break
			fi
		fi

		# 尝试 snap
		if command -v snap >/dev/null 2>&1; then
			$_has_sudo snap install "$_package"
			if command -v "$_command_name" >/dev/null 2>&1; then
				_installed_pkg_name="$_package"
				break
			fi
		fi
	done

	# 5. 检查最终结果
	if command -v "$_command_name" >/dev/null 2>&1; then
		# 跟踪自动安装的包
		case ";$FOUNT_AUTO_INSTALLED_PACKAGES;" in
		*";$_installed_pkg_name;"*) ;; # 已跟踪
		*)
			if [ -z "$FOUNT_AUTO_INSTALLED_PACKAGES" ]; then
				FOUNT_AUTO_INSTALLED_PACKAGES="$_installed_pkg_name"
			else
				FOUNT_AUTO_INSTALLED_PACKAGES="$FOUNT_AUTO_INSTALLED_PACKAGES;$_installed_pkg_name"
			fi
			;;
		esac
		return 0
	else
		echo "Error: Failed to install '$_command_name' from any source." >&2
		return 1
	fi
}

# 1. 确保 bash 可用
install_package "bash" "bash gnu-bash"
if ! command -v bash >/dev/null 2>&1; then
	echo "FATAL: Could not find or install bash. Cannot continue." >&2
	exit 1
fi

# 2. 动态找到 bash 的路径
BASH_EXEC=$(command -v bash)

# 3. 导出环境变量
export FOUNT_AUTO_INSTALLED_PACKAGES

# 4. 使用找到的 bash 执行主脚本
# fount.sh 脚本的路径是相对于 run.sh 脚本的
if [ "$#" -eq 0 ]; then
	"$BASH_EXEC" "$SCRIPT_DIR/path/fount.sh" open keepalive
else
	"$BASH_EXEC" "$SCRIPT_DIR/path/fount.sh" "$@"
fi

# 5. 捕获退出码，并为非正常退出提供用户交互
RETURN_CODE=$?
if [ "$RETURN_CODE" -ne 0 ] && [ "$RETURN_CODE" -ne 255 ]; then
	echo "Press Enter to continue..."
	read -r _
fi

exit "$RETURN_CODE"
