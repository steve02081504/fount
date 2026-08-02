function script:Test-Browser {
	$browser = try {
		$progId = (Get-ItemProperty -Path "Registry::HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" -Name "ProgId" -ErrorAction Stop).'ProgId'

		if ($progId) {
			(Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -Name "(default)" -ErrorAction Stop).'(default)'
		}
	} catch { <# ignore #> }
	try {
		if (!$browser) {
			Test-Winget
			winget install --id Google.Chrome -e --source winget
			New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$FOUNT_DIR/data/installer/auto_installed_chrome" '1'
			RefreshPath
		}
	} catch { $Failed = 1 }
	try {
		if ($Failed) {
			$ChromeSetup = "ChromeSetup.exe"
			Invoke-WebRequest -Uri 'http://dl.google.com/chrome/install/chrome_installer.exe' -OutFile "$env:TEMP\$ChromeSetup"
			& "$env:TEMP\$ChromeSetup" /install
			$Process2Monitor = "ChromeSetup"
			do {
				Start-Sleep -Seconds 2
			} while (Get-Process | Where-Object { $Process2Monitor -contains $_.Name } | Select-Object -ExpandProperty Name)
			Remove-Item "$env:TEMP\$ChromeSetup" -ErrorAction SilentlyContinue

			New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$FOUNT_DIR/data/installer/auto_installed_chrome" '1'
			RefreshPath
		}
	} catch { <# ignore #> }
}
