function script:debug_on {
	$env:FOUNT_DEBUG = $true
	if (Get-Command chrome -ErrorAction Ignore) {
		$hasNodeDevtoolsWindow = Get-Process chrome -ErrorAction Ignore | Where-Object {
			$title = $_.MainWindowTitle
			$title -and ($title -match '\- Node\.js[：:]' -or $title -eq 'DevTools')
		}
		if ($hasNodeDevtoolsWindow) { return }
		$originalClipboard = Get-Clipboard
		Set-Clipboard -Value "chrome://inspect"
		Start-Process "chrome.exe" "--new-window"
		Add-Type -AssemblyName System.Windows.Forms
		Start-Sleep -Seconds 2
		[System.Windows.Forms.SendKeys]::SendWait("^{l}")
		[System.Windows.Forms.SendKeys]::SendWait("^{v}")
		Set-Clipboard -Value $originalClipboard
		[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
		Start-Sleep -Milliseconds 300
		for ($i = 0; $i -lt 5; $i++) {
			[System.Windows.Forms.SendKeys]::SendWait("{TAB}")
		}
		[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
	}
}
