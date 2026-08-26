#!/usr/bin/env pwsh
echo " \`" > /dev/null # " | Out-Null <#
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
exec "$(command -v sh || echo /bin/sh)" "$SCRIPT_DIR/fount" "$@"
exit $?
: << '__END_HEREDOC__'
#>
if (!(Test-Path -LiteralPath $PSScriptRoot/../data/config.json)) {
	Get-ChildItem -Path $PSScriptRoot -Recurse -File -Filter '*.ps1' -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
}
. $PSScriptRoot/src/index.ps1 @args
exit $LastExitCode
function __END_HEREDOC__() {}
__END_HEREDOC__
