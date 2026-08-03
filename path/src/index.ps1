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

. (Join-Path $script:FOUNT_SRC 'load.ps1')
# NativeCommandError：？
$script:FountCallerErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
	require i18n terminal temp_guard env

	check_temp_guard $args[0]

	$ErrorCount = $Error.Count

	if ($env:FOUNT_CLICK) {
		Remove-Item Env:\FOUNT_CLICK -Force -ErrorAction Ignore
		require win/wt
		Start-WTfountCmd @args
		exit $LastExitCode
	}

	require passthrough
	handle_unix_passthrough @args

	$cmd = $args[0]
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
	$ErrorActionPreference = $script:FountCallerErrorActionPreference
}
