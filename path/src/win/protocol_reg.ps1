function script:Register-FountProtocol {
	$protocolName = "fount"
	$protocolDescription = (Get-I18n -key 'protocol.description')
	$command = "`"$FOUNT_DIR\path\fount.bat`" protocolhandle `"%1`""
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
