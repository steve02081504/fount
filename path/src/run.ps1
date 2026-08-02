function run {
	if ($IsWindows) {
		Get-Process tray_windows_release -ErrorAction Ignore | Where-Object { $_.CPU -gt 0.5 } | Stop-Process
	}
	if (isRoot) {
		Write-Warning (Get-I18n -key 'install.rootWarningAsRoot')
		Write-Warning (Get-I18n -key 'install.rootWarningPreferUser')
	}
	Write-TaskbarProgress -Percent 5
	$originalTitle = Get-Title
	Set-Title ""
	$v8Flags = ""
	if ($env:FOUNT_V8_FLAGS) {
		$v8Flags = $env:FOUNT_V8_FLAGS
	}
	$heapSizeMB = 100 # Default to 100MB
	$configPath = Join-Path $FOUNT_DIR 'data/config.json'
	if (Test-Path $configPath) {
		try {
			$fountConfig = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
			$heapSizeBytes = $fountConfig.prelaunch.heapSize
			$calculatedMB = [math]::Round($heapSizeBytes / 1024 / 1024)
			if ($calculatedMB -gt 0) {
				$heapSizeMB = $calculatedMB
			}
		}
		catch {
			# Could not read or parse, will use the default 100MB.
		}
	}
	Write-TaskbarProgress -Percent 10
	if ($v8Flags) { $v8Flags += ",--initial-heap-size=${heapSizeMB}" }
	else { $v8Flags = "--initial-heap-size=${heapSizeMB}" }

	if (-not $env:FOUNT_START_TIME) {
		$env:FOUNT_START_TIME = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
	}
	$env:FOUNT_DENO_START_TIME = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
	Write-TaskbarProgress -Percent 25
	Set-Title "𝓯"
	$proc = [System.Diagnostics.Process]::GetCurrentProcess()
	$prevPriority = $proc.PriorityClass
	$env:FOUNT_STARTUP_PRIORITY_BOOST = '1'
	try { $proc.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::AboveNormal } catch { <# ignore #> }
	try {
		if ($env:FOUNT_DEBUG) {
			deno run --allow-scripts --allow-all --inspect-brk -c "$FOUNT_DIR/deno.json" --v8-flags="$v8Flags" "$FOUNT_DIR/src/server/index.mjs" @args
		}
		else {
			deno run --allow-scripts --allow-all -c "$FOUNT_DIR/deno.json" --v8-flags="$v8Flags" "$FOUNT_DIR/src/server/index.mjs" @args
		}
	}
	finally {
		try { $proc.PriorityClass = $prevPriority } catch { <# ignore #> }
		Remove-Item Env:\FOUNT_STARTUP_PRIORITY_BOOST -Force -ErrorAction Ignore
		Set-Title $originalTitle
		Remove-Item Env:\FOUNT_START_TIME -Force -ErrorAction Ignore
		Remove-Item Env:\FOUNT_DENO_START_TIME -Force -ErrorAction Ignore
		if ($LastExitCode -and $LastExitCode -ne 130) { Write-TaskbarProgressError }
	}
}

function Invoke-FountRunServerWithUpdates {
	param([string[]]$RunArgs)
	run @RunArgs
	# Self-update restart runs bare server — not @RunArgs. e.g. `fount run shell/install x`
	# must not re-run install after crash recovery.
	while ($LastExitCode -eq 131) {
		Update-FountAndDeno
		run
	}
}
