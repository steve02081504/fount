#!/usr/bin/env pwsh
echo " \`" > /dev/null # " | Out-Null <#
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SH_EXEC=$(command -v sh)
"$SH_EXEC" "$SCRIPT_DIR/fount" "$@"
exit $?
: << '__END_HEREDOC__'
#>
$FOUNT_DIR = Split-Path -Parent $PSScriptRoot
$script:FOUNT_SRC = Join-Path $PSScriptRoot 'src'

$env:FOUNT_SESSION_START_TIME = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
if (-not $env:FOUNT_START_TIME) {
	$env:FOUNT_START_TIME = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

# 官方npm源，避免用户自定义源导致各种问题
if (-not $env:NPM_CONFIG_REGISTRY) {
	$env:NPM_CONFIG_REGISTRY = "https://registry.npmjs.org"
}

. (Join-Path $script:FOUNT_SRC 'load.ps1')
. $FountRequireMany i18n terminal temp_guard env

if (($args.Count -eq 0 -or $args[0] -ne 'remove') -and (Test-FountInTempDirectory -Directory $FOUNT_DIR)) {
	Write-Host (Get-I18n -key 'tempDir.blocked')
	exit 1
}

$ErrorCount = $Error.Count

if ($env:FOUNT_CLICK) {
	Remove-Item Env:\FOUNT_CLICK -Force -ErrorAction Ignore
	. $FountRequire win/wt
	Start-WTfountCmd $args
	exit $LastExitCode
}

. $FountRequire passthrough
Invoke-FountUnixPassthrough -CommandArgs $args

. $FountCmdRoute $args
if ($script:FountCmdRouted) {
	if ($ErrorCount -ne $Error.Count) { exit 1 }
	exit $LastExitCode
}

. $FountRequire cmd/default
Invoke-FountCmdDefault -CommandArgs $args

if ($ErrorCount -ne $Error.Count) { exit 1 }
exit $LastExitCode
function __END_HEREDOC__() {}
__END_HEREDOC__
