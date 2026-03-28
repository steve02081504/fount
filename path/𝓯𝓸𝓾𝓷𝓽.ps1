#!/usr/bin/env pwsh
echo " \`" > /dev/null # " | Out-Null <#
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SH_EXEC=$(command -v sh)
"$SH_EXEC" "$SCRIPT_DIR/fount" "$@"
exit $?
: << '__END_HEREDOC__'
#>
. $PSScriptRoot/fount.ps1 @args
exit $LastExitCode
function __END_HEREDOC__() {}
__END_HEREDOC__
