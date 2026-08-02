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
. $FountRequireMany i18n terminal temp_guard

if (($args.Count -eq 0 -or $args[0] -ne 'remove') -and (Test-FountInTempDirectory -Directory $FOUNT_DIR)) {
	Write-Host (Get-I18n -key 'tempDir.blocked')
	exit 1
}

$ErrorCount = $Error.Count

$FountRequireMid = {
	. $FountRequireMany env win/refresh_path win/winget win/installer_dir
	. $FountRequireMany packages browser passthrough profile
	. $FountRequireMany git deno fs init_force update run debug boot
	. $FountRequireMany win/file_attrs win/wt win/protocol_reg keybindings desktop
	. $FountRequireMany win/app_restart win/explorer_refresh win/keep_awake first_install
}

if ($env:FOUNT_CLICK) {
	Remove-Item Env:\FOUNT_CLICK -Force -ErrorAction Ignore
	. $FountRequire win/wt
	Start-WTfountCmd $args
	exit $LastExitCode
}
if ($args[0] -eq 'nop') {
	exit 0
}
elseif ($args[0] -eq 'open') {
	. $FountRequireMany passthrough win/refresh_path win/winget browser cmd/open
	Invoke-FountCmdOpen -CommandArgs $args
	exit $LastExitCode
}
elseif ($args[0] -eq 'background') {
	. $FountRequireMany passthrough cmd/background
	Invoke-FountCmdBackground -CommandArgs $args
	exit $LastExitCode
}
elseif ($args[0] -eq 'protocolhandle') {
	. $FountRequireMany passthrough win/refresh_path win/winget browser win/wt packages cmd/protocolhandle
	Invoke-FountCmdProtocolhandle -CommandArgs $args
	exit $LastExitCode
}

. $FountRequire passthrough
Invoke-FountUnixPassthrough -CommandArgs $args

. $FountRequireMid

if ($args[0] -eq 'init' -and $args[1] -eq 'force') {
	exit (Invoke-FountInitForce -FountDir $FOUNT_DIR)
}

$is_running = $args.Count -ne 0 -and ($args[0] -eq 'server' -or $args[0] -eq 'keepalive')
if ($is_running) {
	Assert-FountDirWritable $FOUNT_DIR
	Update-FountAndDeno
	deno -V
}

Invoke-FountFirstInstall -CommandArgs $args

if (Invoke-FountCmdRoute -CommandArgs $args) {
	if ($ErrorCount -ne $Error.Count) { exit 1 }
	exit $LastExitCode
}

. $FountRequire cmd/default
Invoke-FountCmdDefault -CommandArgs $args

if ($ErrorCount -ne $Error.Count) { exit 1 }
exit $LastExitCode
function __END_HEREDOC__() {}
__END_HEREDOC__
