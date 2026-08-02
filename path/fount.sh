#!/usr/bin/env bash

# fount 脚本需要兼容 mac 的上古版本 bash，尽量避免使用新版本语法

# BSD date（macOS）不支持 %3N（毫秒），会原样输出；降级到秒精度
_fount_timestamp() {
	local t
	t=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null)
	case "$t" in *%3N*) date -u +"%Y-%m-%dT%H:%M:%SZ" ;; *) printf '%s' "$t" ;; esac
}
FOUNT_SESSION_START_TIME=$(_fount_timestamp)
export FOUNT_SESSION_START_TIME
if [ -z "$FOUNT_START_TIME" ]; then
	FOUNT_START_TIME=$(_fount_timestamp)
fi
export FOUNT_START_TIME

# 官方 npm 源，避免用户自定义源导致各种问题
if [ -z "$NPM_CONFIG_REGISTRY" ]; then
	NPM_CONFIG_REGISTRY="https://registry.npmjs.org"
	export NPM_CONFIG_REGISTRY
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
FOUNT_DIR=$(dirname "$SCRIPT_DIR")
FOUNT_SRC="$SCRIPT_DIR/src"

# shellcheck disable=SC1091
. "$FOUNT_SRC/load.sh"

fount_require i18n terminal temp_guard env packages profile
load_installed_packages
ensure_fount_path

check_temp_guard "${1:-}"

if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
	powershell.exe -noprofile -executionpolicy bypass -file "$FOUNT_DIR\path\fount.ps1" "$@"
	exit $?
fi

cmd="${1:-}"

# Early passthrough commands (before deno install)
case "$cmd" in
nop|open|background|protocolhandle)
	fount_require passthrough browser unix/ipc unix/url
	# shellcheck disable=SC1090
	. "$FOUNT_SRC/cmd/${cmd}.sh"
	"fount_cmd_${cmd}" "$@"
	exit $?
	;;
esac

# init force (privilege elevation + permission repair)
if [ "$cmd" = "init" ] && [ "${2:-}" = "force" ]; then
	fount_require fs init_force
	fount_handle_init_force "$@"
fi

fount_require_mid

if [ "$#" -gt 0 ] && { [ "$1" = "server" ] || [ "$1" = "keepalive" ]; }; then
	assert_fount_dir_writable "$FOUNT_DIR"
	update_fount_and_deno
	run_deno -V
fi

fount_first_install_if_needed "$@"

if [ -n "$cmd" ] && [[ "$cmd" =~ ^[a-z]+$ ]] && [ -f "$FOUNT_SRC/cmd/${cmd}.sh" ]; then
	# shellcheck disable=SC1090
	. "$FOUNT_SRC/cmd/${cmd}.sh"
	"fount_cmd_${cmd}" "$@"
	exit $?
fi

# shellcheck disable=SC1091
. "$FOUNT_SRC/cmd/default.sh"
fount_cmd_default "$@"
exit $?
