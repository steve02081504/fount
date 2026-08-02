function Test-Winget {
	try {
		if (!(Get-Command winget -ErrorAction SilentlyContinue)) {
			Import-Module Appx
			try {
				Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
			}
			catch {
				try {
					Invoke-WebRequest -Uri https://aka.ms/getwinget -OutFile "$env:TEMP/winget.msixbundle"
					Add-AppxPackage -Path "$env:TEMP/winget.msixbundle"
					Remove-Item "$env:TEMP/winget.msixbundle" -Force -ErrorAction SilentlyContinue
				}
				catch {
					Add-AppxPackage -Path https://cdn.winget.microsoft.com/cache/source.msix
				}
			}
			New-Item -Path "$FOUNT_DIR/data/installer" -ItemType Directory -Force | Out-Null
			Set-Content "$FOUNT_DIR/data/installer/auto_installed_winget" '1'
			RefreshPath
		}
	} catch { <# ignore #> }
}
