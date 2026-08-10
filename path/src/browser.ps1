function script:Get-Browser {
	try {
		$progId = (Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" -Name "ProgId" -ErrorAction Stop).'ProgId'

		if ($progId) {
			(Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -Name "(default)" -ErrorAction Stop).'(default)'
		}
	} catch { <# ignore #> }
}

function script:Test-Browser {
	if (Get-Browser) { return $true }
	try {
		Test-Winget
		winget install --id Google.Chrome -e --source winget
	} catch { <# ignore #> }
	if (!(Get-Browser)) {
		try {
			$ChromeSetup = "ChromeSetup.exe"
			Invoke-WebRequest -Uri 'https://dl.google.com/chrome/install/chrome_installer.exe' -OutFile "$env:TEMP\$ChromeSetup"
			$installer = Start-Process -FilePath "$env:TEMP\$ChromeSetup" -ArgumentList '/install' -PassThru
			do {
				Start-Sleep -Seconds 2
			} while (-not $installer.HasExited)
			Remove-Item "$env:TEMP\$ChromeSetup" -ErrorAction SilentlyContinue
		} catch { <# ignore #> }
	}

	if (Get-Browser) {
		New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
		Set-Content "$FOUNT_DIR/data/installer/auto_installed_chrome" '1'
		RefreshPath
		return $true
	}
}
