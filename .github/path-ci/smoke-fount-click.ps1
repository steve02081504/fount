# FOUNT_CLICK smoke helper: script-scoped stubs + dot-source fount (exit stays in this process).
# Writes capture JSON then lets fount exit; parent run-smoke.ps1 reads CapturePath.
param(
	[Parameter(Mandatory)][ValidateSet('Windows', 'Unix')][string]$Mode,
	[Parameter(Mandatory)][string]$FountPath,
	[Parameter(Mandatory)][string]$RepoRoot,
	[Parameter(Mandatory)][string]$CapturePath
)

$ErrorActionPreference = 'Stop'
$env:FOUNT_DIR = $RepoRoot
$env:FOUNT_CLICK = '1'

if ($Mode -eq 'Windows') {
	$script:WindowsTerminalStartCaptured = $null
	function script:Start-Process {
		param(
			[Parameter(Mandatory)][AllowNull()][string]$FilePath,
			$ArgumentList
		)
		if ((Split-Path -Leaf $FilePath) -notin @('powershell.exe', 'wt.exe')) {
			throw "[wt start] unsupported FilePath: $FilePath"
		}
		$script:WindowsTerminalStartCaptured = @{
			FilePath     = $FilePath
			ArgumentList = "$ArgumentList"
		}
		($script:WindowsTerminalStartCaptured | ConvertTo-Json -Compress) |
			Set-Content -LiteralPath $CapturePath -Encoding utf8
	}
	. $FountPath open
	exit $LastExitCode
}

$script:UnixPassthroughBashArgs = $null
function script:bash {
	param([Parameter(ValueFromRemainingArguments = $true)]$BashArgs)
	if (Test-Path Env:FOUNT_CLICK) {
		throw '[FOUNT_CLICK unix] FOUNT_CLICK still set when bash invoked'
	}
	$script:UnixPassthroughBashArgs = @($BashArgs)
	(@{ Args = $script:UnixPassthroughBashArgs } | ConvertTo-Json -Compress) |
		Set-Content -LiteralPath $CapturePath -Encoding utf8
	# End this helper process; avoid needing a global $LastExitCode hack for exit $LastExitCode.
	exit 0
}
. $FountPath open
exit $LastExitCode
