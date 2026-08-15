# Main CLI dispatcher (dot-sourced from path/fount.ps1).

if (-not $script:FOUNT_SRC) {
	$script:FOUNT_SRC = $PSScriptRoot
}
if (-not $FOUNT_DIR) {
	$FOUNT_DIR = Split-Path -Parent (Split-Path -Parent $script:FOUNT_SRC)
}

$env:FOUNT_SESSION_START_TIME = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
if (-not $env:FOUNT_START_TIME) {
	$env:FOUNT_START_TIME = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

# 官方npm源，避免用户自定义源导致各种问题
if (-not $env:NPM_CONFIG_REGISTRY) {
	$env:NPM_CONFIG_REGISTRY = "https://registry.npmjs.org"
}

# MSYS/Cygwin bash 继承的 PATH 常缺 Windows User/Machine 项；先刷新再 require git 等。
if ($env:OSTYPE -match '^(msys|cygwin)') {
	. (Join-Path $script:FOUNT_SRC 'win\refresh_path.ps1')
	MergePath
}

. (Join-Path $script:FOUNT_SRC 'load.ps1')
# NativeCommandError：？
$script:FountCallerErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
	require env i18n eula terminal temp_guard

	check_temp_guard $args[0]

	$ErrorCount = $Error.Count

	require passthrough
	handle_unix_passthrough @args

	if ($env:FOUNT_CLICK) {
		Remove-Item Env:\FOUNT_CLICK -Force -ErrorAction Ignore
		require win/wt
		Start-WTfountCmd @args
		if ($ErrorCount -ne $Error.Count) { exit 1 }
		exit 0
	}

	$cmd = $args[0]
	if (-not (Test-Path -Path "$FOUNT_DIR/data/config.json") -and $cmd -ne 'remove') {
		Ensure-FountConfig
		if ($ErrorCount -ne $Error.Count) { exit 1 }
	}
	if ($cmd -and $cmd -match '^[a-z]+$') {
		$commandFile = Join-Path $script:FOUNT_SRC "cmd\$cmd.ps1"
		if (Test-Path -LiteralPath $commandFile) {
			. $commandFile
			& "cmd_$cmd" @args
			if ($ErrorCount -ne $Error.Count) { exit 1 }
			exit $LastExitCode
		}
	}

	require cmd/default
	cmd_default @args

	if ($ErrorCount -ne $Error.Count) { exit 1 }
	exit $LastExitCode
} finally {
	Stop-FountStatusServer
	$ErrorActionPreference = $script:FountCallerErrorActionPreference
}
