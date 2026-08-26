function script:Register-FountBootBackground {
	if (!$IsWindows -or (in_container)) { return }
	if (Test-Path "$FOUNT_DIR/.noautoboot") { return }
	try {
		$shellExe = if (Get-Command powershell.exe -ErrorAction SilentlyContinue) {
			(Get-Command powershell.exe).Source
		}
		elseif (Test-Path -LiteralPath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe") {
			"$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
		}
		elseif (Get-Command pwsh -ErrorAction SilentlyContinue) {
			(Get-Command pwsh).Source
		}
		$fountPs1 = Join-Path $FOUNT_DIR 'path\fount.ps1'
		$runValue = "`"$shellExe`" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$fountPs1`" background keepalive"
		$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
		if (-not (Test-Path $runKey)) {
			New-Item -Path $runKey -Force | Out-Null
		}
		Set-ItemProperty -Path $runKey -Name 'fount' -Value $runValue -Type String -ErrorAction Stop
	}
	catch {
		Write-Warning $_.Exception.Message
	}
}
