#!/usr/bin/env bash
# Color output definitions (exported for sourced modules)
export C_RESET='\033[0m'
export C_RED='\033[0;31m'
export C_GREEN='\033[0;32m'
export C_YELLOW='\033[0;33m'

# ANSI support detection (top-level, export so subshells inherit)
FOUNT_CONSOLE_ANSI=0
[ -t 1 ] && FOUNT_CONSOLE_ANSI=1
export FOUNT_CONSOLE_ANSI

# Environment detection
IN_DOCKER=0
if [ -f "/.dockerenv" ] || grep -q 'docker\|containerd' /proc/1/cgroup 2>/dev/null; then
	IN_DOCKER=1
fi
IN_TERMUX=0
if [[ -d "/data/data/com.termux" ]]; then
	IN_TERMUX=1
fi
OS_TYPE="$(uname -s)"
export OS_TYPE

in_docker() { [ "$IN_DOCKER" -eq 1 ]; }
in_termux() { [ "$IN_TERMUX" -eq 1 ]; }
in_container() { in_docker || in_termux; }

# Termux: Android system locale → LANG (before i18n).
if [ "$IN_TERMUX" -eq 1 ]; then
	require unix/termux
	termux_apply_android_lang
fi

# Installer data paths (exported for packages.sh / deno.sh / uninstall hooks)
export INSTALLER_DATA_DIR="$FOUNT_DIR/data/installer"
export INSTALLED_SYSTEM_PACKAGES_FILE="$INSTALLER_DATA_DIR/auto_installed_system_packages"
export INSTALLED_PACMAN_PACKAGES_FILE="$INSTALLER_DATA_DIR/auto_installed_pacman_packages"
export AUTO_INSTALLED_DENO_FLAG="$INSTALLER_DATA_DIR/auto_installed_deno"

# Best-effort Clash TUN enablement for users in restricted regions
if echo "${LANG:-}" | grep -iqE "_(CN|KP|RU)|(^|-)(zh|ko|ru)(-|$)"; then
	(
		TARGETS="github.com cdn.jsdelivr.net"
		for host in $TARGETS; do
			if ! ping -c 1 -W 2 "$host" >/dev/null 2>&1; then
				curl -X PATCH "http://127.0.0.1:9090/configs" \
					-d '{"tun":{"enable":true}}' \
					-s -o /dev/null --max-time 3
				curl -X PATCH "http://127.0.0.1:9097/configs" \
					-d '{"tun":{"enable":true}}' \
					-s -o /dev/null --max-time 3
				break
			fi
		done
	) >/dev/null 2>&1 &
fi
