function script:cmd_keepalive {
	bootstrap_server @args
	Start-Job -ScriptBlock {
		$FOUNT_DIR = $args[0]
		if (Get-Command compact.exe -ErrorAction SilentlyContinue) {
			$qualifier = Split-Path -Qualifier $FOUNT_DIR
			if ($qualifier) {
				$driveInfo = [System.IO.DriveInfo]::new($qualifier)
				if ($driveInfo.IsReady -and $driveInfo.DriveFormat -eq 'NTFS') {
					Set-Location $FOUNT_DIR
					compact.exe /c /s /q
				}
			}
		}
	} -ArgumentList $FOUNT_DIR | Out-Null

	$args = @($args | Select-Object -Skip 1)

	$env:FOUNT_KEEPALIVE = 1
	try {
		Register-FountApplicationRestart
		if ($args.Count -gt 0 -and $args[0] -eq 'debug') {
			$args = @($args | Select-Object -Skip 1)
			debug_on
		}
		$startTime = Get-Date
		$initAttempted = $false
		$restart_timestamps = New-Object System.Collections.Generic.List[datetime]

		& (Join-Path $FOUNT_DIR 'path/fount.ps1') server @args
		while ($LastExitCode) {
			if ($LastExitCode -eq 130) { exit 130 } # ctrl+c
			if ($LastExitCode -ne 131) {
				$elapsedTime = (Get-Date) - $startTime
				if ($elapsedTime.TotalMinutes -lt 3 -and $initAttempted) {
					Write-Error (Get-I18n -key 'keepalive.failedToStart')
					exit 1
				} else { $initAttempted = $false }

				$current_time = Get-Date
				$restart_timestamps.Add($current_time)

				$three_minutes_ago = $current_time.AddMinutes(-3)
				for ($i = $restart_timestamps.Count - 1; $i -ge 0; $i--) {
					if ($restart_timestamps[$i] -lt $three_minutes_ago) {
						$restart_timestamps.RemoveAt($i)
					}
				}

				if ($restart_timestamps.Count -ge 7) {
					if (Test-Path -Path "$FOUNT_DIR/.noautoinit") {
						Write-Warning (Get-I18n -key 'keepalive.autoInitDisabled')
						exit 1
					}
					Write-Warning (Get-I18n -key 'keepalive.restartingTooFast')
					$restart_timestamps.Clear()

					& (Join-Path $FOUNT_DIR 'path/fount.ps1') init
					if ($LastExitCode -ne 0) {
						Write-Error (Get-I18n -key 'keepalive.initFailed')
						exit 1
					}
					$initAttempted = $true
					Write-Host (Get-I18n -key 'keepalive.initComplete')
				}
			}
			& (Join-Path $FOUNT_DIR 'path/fount.ps1') server
		}
	}
	finally {
		Remove-Item Env:\FOUNT_KEEPALIVE -Force -ErrorAction Ignore
		Unregister-FountApplicationRestart
		Write-TaskbarProgressClear
	}
}
