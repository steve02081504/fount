#!/bin/sh
# fount 开发环境检查

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
cd "$REPO_ROOT" || exit 1

# Windows（Git Bash / Cygwin / MSYS）转交 PowerShell
OSTYPE=$(uname -s 2>/dev/null)
case "$OSTYPE" in MINGW*|MSYS*|CYGWIN*)
	export OSTYPE
	powershell.exe -noprofile -executionpolicy bypass -file "$SCRIPT_DIR/main.ps1" "$@"
	exit $?
	;;
esac

if [ -t 1 ]; then
	cat imgs/icon_ansi_ascii.txt
else
	cat imgs/icon_ascii.txt
fi

all_set=1

check_cmd() {
	cmd=$1
	get_description=$2
	if ! command -v "$cmd" >/dev/null 2>&1; then
		printf '✘ %s is not in path\n' "$cmd"
		printf '%s\n' "$get_description" >&2
		all_set=0
		return 1
	fi
	printf '✔ %s is in path\n' "$cmd"
	return 0
}

check_cmd git 'install from https://git-scm.com/downloads'
check_cmd deno 'run fount and itll be auto-installed'

if check_cmd gh 'install from https://github.com/cli/cli/releases'; then
	if gh auth status 2>&1 | grep -q 'Logged in'; then
		printf '  ✔ gh logged in\n'
	else
		printf '  ✘ gh not logged in\n'
		printf "   run \`gh auth login\` to login\n" >&2
		all_set=0
	fi
fi

check_cmd fount.sh 'run fount and itll be auto-added to path'

if [ "$all_set" -eq 1 ]; then
	printf '🥳 All commands are usable, your dev environment is ready!\n'
else
	printf '❌ Some commands are not correctly configured, please check the output above\n'
fi

if [ ! -f ./data/test/report.md ]; then
	printf '🔥 Creating test cache...\n'
	"$REPO_ROOT/path/fount.sh" test || true
	printf '🥳 Test cache created successfully\n'
fi

[ "$all_set" -eq 1 ] || exit 1
