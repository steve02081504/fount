function script:cmd_open {
	require passthrough win/refresh_path win/winget browser eula
	if (Test-Path -Path "$FOUNT_DIR/data/config.json") {
		handle_docker_passthrough @args
		Test-Browser
		Start-Process 'https://steve02081504.github.io/fount/wait?cold_bootting=true'
		fount.ps1 @($args | Select-Object -Skip 1)
		exit $LastExitCode
	}

	$rest = @($args | Select-Object -Skip 1)
	if (Test-FountEulaEnvAccepted) {
		Copy-FountDefaultConfig
		fount.ps1 @rest
		exit $LastExitCode
	}

	$acceptFile = Join-Path ([IO.Path]::GetTempPath()) "fount-eula-accepted-$PID"
	$statusServerJob = $null
	try {
		if (-not (Test-FountConsoleInput)) {
			$Host.UI.WriteErrorLine("EULA acceptance is required. Re-run with FOUNT_ACCEPT_EULA=1, or from an interactive terminal.")
			$Host.UI.WriteErrorLine($script:FountEulaUrl)
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') remove
			exit $LastExitCode
		}
		Remove-Item -LiteralPath $acceptFile -Force -ErrorAction Ignore
		$statusServerJob = Start-FountStatusServer -AcceptFile $acceptFile
		Test-Browser
		Start-Process $script:FountInstallWaitUrl
		if (-not (Confirm-FountEula -AcceptFile $acceptFile)) {
			Write-Host "EULA declined. Removing fount."
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') remove
			exit $LastExitCode
		}
		Copy-FountDefaultConfig
		fount.ps1 @rest
		exit $LastExitCode
	}
	finally {
		if ($null -ne $statusServerJob) {
			Stop-Job $statusServerJob -ErrorAction SilentlyContinue
			Remove-Job $statusServerJob -Force -ErrorAction SilentlyContinue
		}
		Remove-Item -LiteralPath $acceptFile -Force -ErrorAction Ignore
	}
}
