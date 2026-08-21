function script:Register-FountProtocol {
	$protocolName = "fount"
	$protocolDescription = (Get-I18n -key 'protocol.description')
	$shellExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) {
		(Get-Command pwsh).Source
	}
	elseif (Get-Command powershell.exe -ErrorAction SilentlyContinue) {
		(Get-Command powershell.exe).Source
	}
	else {
		"$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
	}
	if (Test-Path -LiteralPath $shellExe) {
		$fountPs1 = Join-Path $FOUNT_DIR 'path\fount.ps1'
		$command = "`"$shellExe`" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$fountPs1`" protocolhandle `"%1`""
	}
	else {
		$command = "`"$FOUNT_DIR\path\fount.bat`" protocolhandle `"%1`""
	}
	try {
		New-Item -Path "HKCU:\Software\Classes\$protocolName" -Force | Out-Null
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName" -Name "(Default)" -Value $protocolDescription -ErrorAction Stop
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName" -Name "URL Protocol" -Value "" -ErrorAction Stop
		New-Item -Path "HKCU:\Software\Classes\$protocolName\shell\open\command" -Force | Out-Null
		Set-ItemProperty -Path "HKCU:\Software\Classes\$protocolName\shell\open\command" -Name "(Default)" -Value $command -ErrorAction Stop
	}
	catch {
		Write-Warning (Get-I18n -key 'protocol.registerFailed' -params @{message = $_.Exception.Message })
	}
}
