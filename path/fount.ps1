#!/usr/bin/env pwsh
echo " \`" > /dev/null # " | Out-Null <#
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
exec "$(command -v sh || echo /bin/sh)" "$SCRIPT_DIR/fount" "$@"
exit $?
: << '__END_HEREDOC__'
#>
if (-not $FOUNT_DIR) {
	$FOUNT_DIR = Split-Path -Parent $PSScriptRoot
}
$desktopIni = Get-Item -LiteralPath "$FOUNT_DIR/desktop.ini" -Force -ErrorAction Ignore
$desktopIniFlags = [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System
if ($desktopIni -and -not ($desktopIni.Attributes -band $desktopIniFlags)) {
	Get-ChildItem -LiteralPath $FOUNT_DIR -Recurse -File -Force -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
	. $PSScriptRoot/src/win/installer_dir.ps1
	. $PSScriptRoot/src/win/file_attrs.ps1
	Initialize-FountDesktopIni
}
elseif (!(Test-Path -LiteralPath $PSScriptRoot/../data/config.json)) {
	Get-ChildItem -Path $PSScriptRoot -Recurse -File -Filter '*.ps1' -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
}
. $PSScriptRoot/src/index.ps1 @args
exit $LastExitCode
function __END_HEREDOC__() {}
__END_HEREDOC__
