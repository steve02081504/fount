#!/usr/bin/env bash

# fount 脚本需要兼容 mac 的上古版本 bash，尽量避免使用新版本语法

if [ -z "${FOUNT_SRC:-}" ]; then
	FOUNT_SRC=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
fi
if [ -z "${FOUNT_DIR:-}" ]; then
	FOUNT_DIR=$(dirname "$(dirname "$FOUNT_SRC")")
fi

# BSD date（macOS）不支持 %3N（毫秒），会原样输出；降级到秒精度
timestamp() {
	local timestamp
	timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null)
	case "$timestamp" in *%3N*) date -u +"%Y-%m-%dT%H:%M:%SZ" ;; *) printf '%s' "$timestamp" ;; esac
}
FOUNT_SESSION_START_TIME=$(timestamp)
export FOUNT_SESSION_START_TIME
if [ -z "$FOUNT_START_TIME" ]; then
	FOUNT_START_TIME=$(timestamp)
fi
export FOUNT_START_TIME

# 官方 npm 源，避免用户自定义源导致各种问题
if [ -z "$NPM_CONFIG_REGISTRY" ]; then
	NPM_CONFIG_REGISTRY="https://registry.npmjs.org"
	export NPM_CONFIG_REGISTRY
fi

# shellcheck disable=SC1091
. "$FOUNT_SRC/load.sh"

require i18n terminal temp_guard env packages profile
load_installed_packages
ensure_fount_path

check_temp_guard "${1:-}"

if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
	export OSTYPE
	powershell.exe -noprofile -executionpolicy bypass -file "$FOUNT_DIR/path/fount.ps1" "$@"
	exit $?
fi

cmd="${1:-}"

if [ -n "$cmd" ] && [[ "$cmd" =~ ^[a-z]+$ ]] && [ -f "$FOUNT_SRC/cmd/${cmd}.sh" ]; then
	# shellcheck disable=SC1090
	. "$FOUNT_SRC/cmd/${cmd}.sh"
	"cmd_${cmd}" "$@"
	exit $?
fi

# shellcheck disable=SC1091
. "$FOUNT_SRC/cmd/default.sh"
cmd_default "$@"
exit $?
