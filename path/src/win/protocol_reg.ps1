function script:Register-FountProtocol {
	$protocolName = "fount"
	$protocolDescription = (Get-I18n -key 'protocol.description')
	# wscript 是 GUI 子系统进程（不分配控制台），经 hidden_launch.vbs 以窗口样式 0
	# 隐藏拉起 powershell，避免浏览器 ShellExecute 启动协议处理器时闪出 PowerShell 蓝框。
	$shellExe = if (Get-Command powershell.exe -ErrorAction SilentlyContinue) {
		(Get-Command powershell.exe).Source
	}
	elseif (Test-Path -LiteralPath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe") {
		"$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
	}
	elseif (Get-Command pwsh -ErrorAction SilentlyContinue) {
		(Get-Command pwsh).Source
	}
	$vbsPath = Join-Path $FOUNT_DIR 'path\src\win\hidden_launch.vbs'
	$prefixCmd = "`"$shellExe`" -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $FOUNT_DIR 'path\fount.ps1')`" protocolhandle"
	$encodedPrefix = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($prefixCmd))
	$command = "`"$env:SystemRoot\System32\wscript.exe`" //nologo `"$vbsPath`" `"$encodedPrefix`" `"%1`""
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
